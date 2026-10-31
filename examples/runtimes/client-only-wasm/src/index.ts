import { getQuickJS, QuickJSContext } from 'quickjs-emscripten';
import path from 'node:path';
import fs from 'node:fs';
import tsc from 'typescript';
import chokidar from 'chokidar';

const root = path.resolve(import.meta.dir, '../../../plugins/server-only');
const typesRoot = path.resolve(import.meta.dir, 'types');

const PLUGIN_CONFIG = {
  root,
  srcPattern: path.join(root, '**/*.ts'),
  entryPoint: path.join(root, 'entry-sp.ts'),
  outDir: path.join(root, 'dist'),
}

function exposeApi(vm: QuickJSContext) {
  // We explicitly give access ONLY to what we want (e.g., "drawPixel", "score")
  const logHandle = vm.newFunction("log", (msgHandle) => {
    const msg = vm.getString(msgHandle);
    console.log(`[Game]: ${msg}`);
  });
  const countHandle = vm.newNumber(0);
  vm.setProp(vm.global, "print", logHandle);
  vm.setProp(vm.global, "count", countHandle);
  return { logHandle, countHandle };
}

async function run(entryCode: string, modules: Map<string, string>) {
  
  // 1. Boot the Wasm Engine
  const QuickJS = await getQuickJS();
  
  // 2. Create a clean sandbox (virtual machine)
  const runtime = QuickJS.newRuntime()
  // "Should be enough for everyone" -- attributed to B. Gates
  runtime.setMemoryLimit(1024 * 640)
  // Limit stack size
  runtime.setMaxStackSize(1024 * 320)
  // Interrupt computation after 1024 calls to the interrupt handler
  let interruptCycles = 0
  runtime.setInterruptHandler(() => ++interruptCycles > 1024)
  
  const vm = runtime.newContext();
  
  // 3. Expose LIMITED API (The "Console SDK")
  const apiHandles = exposeApi(vm);
  
  // 3.5 Set up module loader to resolve modules from the Map
  runtime.setModuleLoader((moduleName: string) => {
    // Try exact match first
    let moduleContent = modules.get(moduleName);
    
    // If still not found, try with ./ prefix
    if (!moduleContent && !moduleName.startsWith('./')) {
      moduleContent = modules.get('./' + moduleName) || modules.get('./' + moduleName + '.js');
    }
    
    if (!moduleContent) {
      throw new Error(`Module not found: ${moduleName}`);
    }
    
    return moduleContent;
  });

  const startTime = performance.now();

  // 4. Execute the entry code
  const result = vm.evalCode(entryCode);

  // 6. Check for errors or success
  if (result.error) {
    const error = vm.dump(result.error);
    console.error("Crashed:", error);
    result.error.dispose();
  } else {
    const endTime = performance.now();
    const duration = endTime - startTime;
    console.log(`⏱️  Execution time: ${duration.toFixed(2)}ms`);

    console.log("Finished:", vm.dump(result.value));
    result.value.dispose();
  }

  // 7. Cleanup
  Object.values(apiHandles).forEach(handle => handle.dispose());
  
  // 9. Eject (Cleanup Memory)
  vm.dispose();
  runtime.dispose();
  
  
}

async function watchAndTranspilePlugin() {
  let isBuilding = false;
  let buildTimeout: ReturnType<typeof setTimeout> | null = null;

  const buildAndRunPlugin = async () => {
    if (isBuilding) return;
    
    isBuilding = true;
    const totalStartTime = performance.now();
    
    try {
      // Ensure output directory exists
      if (!fs.existsSync(PLUGIN_CONFIG.outDir)) {
        fs.mkdirSync(PLUGIN_CONFIG.outDir, { recursive: true });
      }

      // Find all TypeScript files in the plugin directory
      const findTsFiles = (dir: string): string[] => {
        const files: string[] = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory() && entry.name !== 'dist' && entry.name !== 'node_modules') {
            files.push(...findTsFiles(fullPath));
          } else if (entry.isFile() && entry.name.endsWith('.ts')) {
            files.push(fullPath);
          }
        }
        return files;
      };

      const tsFiles = findTsFiles(PLUGIN_CONFIG.root);
      
      // Start timing transpilation
      const transpileStartTime = performance.now();
      
      // Create TypeScript program
      const program = tsc.createProgram(tsFiles, {
        target: tsc.ScriptTarget.ESNext,
        module: tsc.ModuleKind.ESNext,
        moduleResolution: tsc.ModuleResolutionKind.Bundler,
        allowJs: true,
        skipLibCheck: true,
        outDir: PLUGIN_CONFIG.outDir,
        rootDir: PLUGIN_CONFIG.root,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        types: [path.join(typesRoot, 'server-only.d.ts')],
      });

      // Emit files
      const emitResult = program.emit();

      // Check for compilation errors
      const diagnostics = tsc
        .getPreEmitDiagnostics(program)
        .concat(emitResult.diagnostics);

      if (diagnostics.length > 0) {
        diagnostics.forEach(diagnostic => {
          if (diagnostic.file && diagnostic.start !== undefined) {
            const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
            const message = tsc.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
            console.error(`❌ ${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`);
          } else {
            console.error(`❌ ${tsc.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
          }
        });
        throw new Error('TypeScript compilation failed');
      }

      const transpileEndTime = performance.now();
      const transpileDuration = transpileEndTime - transpileStartTime;
      console.log(`✅ Plugin transpiled successfully (${transpileDuration.toFixed(2)}ms)`);

      // Load all transpiled modules (files keep their original names)
      const modules = new Map<string, string>();
      const jsFiles = fs.readdirSync(PLUGIN_CONFIG.outDir)
        .filter(file => file.endsWith('.js'));

      for (const fileName of jsFiles) {
        const filePath = path.join(PLUGIN_CONFIG.outDir, fileName);
        const content = fs.readFileSync(filePath, 'utf8');
        // Store with './filename.js' format (as used in imports)
        modules.set('./' + fileName, content);
      }

      // Read and run the entry point
      const transpiledEntrypoint = path.join(PLUGIN_CONFIG.outDir, 'entry-sp.js');
      if (!fs.existsSync(transpiledEntrypoint)) {
        throw new Error(`Entry point not found: ${transpiledEntrypoint}`);
      }
      
      console.log('👀 Running plugin...');
      const entryCode = fs.readFileSync(transpiledEntrypoint, 'utf8');
      await run(entryCode, modules);
      
      const totalEndTime = performance.now();
      const totalDuration = totalEndTime - totalStartTime;
      console.log(`⏱️  Total time: ${totalDuration.toFixed(2)}ms (transpile: ${transpileDuration.toFixed(2)}ms)`);
    } catch (error) {
      console.error('❌ Transpile error:', error);
    } finally {
      isBuilding = false;
    }
  };

  // Initial build
  await buildAndRunPlugin();

  // Watch for changes using chokidar
  // Watch the directory and filter for .ts files
  console.log(`👀 Setting up watcher for directory: ${PLUGIN_CONFIG.root}`);
  console.log(`👀 Resolved root: ${path.resolve(PLUGIN_CONFIG.root)}`);
  
  const watcher = chokidar.watch(PLUGIN_CONFIG.root, {
    ignored: [
      /(^|[\/\\])\../, // ignore dotfiles
      /node_modules/,
      /dist/,
      /\.tsbuildinfo$/,
    ],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
    depth: 10, // watch up to 10 levels deep
  });

  watcher.on('ready', () => {
    console.log(`✅ Watcher ready, monitoring ${PLUGIN_CONFIG.root} for changes...`);
  });

  watcher.on('change', (filePath) => {
    console.log(`👀 File changed: ${filePath}`);
    
    if (filePath.endsWith('.ts')) {
      console.log(`🔄 Scheduling rebuild for ${filePath}...`);
      // Debounce rapid changes
      if (buildTimeout) {
        clearTimeout(buildTimeout);
      }
      buildTimeout = setTimeout(() => {
        console.log(`🚀 Triggering rebuild...`);
        buildAndRunPlugin();
      }, 200);
    }
  });

  watcher.on('add', (filePath) => {
    console.log(`➕ File added: ${filePath}`);
    if (filePath.endsWith('.ts')) {
      console.log(`🔄 Scheduling rebuild for ${filePath}...`);
      // Debounce rapid changes
      if (buildTimeout) {
        clearTimeout(buildTimeout);
      }
      buildTimeout = setTimeout(() => {
        console.log(`🚀 Triggering rebuild...`);
        buildAndRunPlugin();
      }, 200);
    }
  });

  watcher.on('unlink', (filePath) => {
    console.log(`🗑️  File removed: ${filePath}`);
  });

  watcher.on('error', (error) => {
    console.error('❌ Watcher error:', error);
  });

  // Cleanup on exit
  process.on("SIGINT", async () => {
    await watcher.close();
    if (buildTimeout) clearTimeout(buildTimeout);
    process.exit();
  });

  process.on("SIGTERM", async () => {
    await watcher.close();
    if (buildTimeout) clearTimeout(buildTimeout);
    process.exit();
  });
}

watchAndTranspilePlugin();

