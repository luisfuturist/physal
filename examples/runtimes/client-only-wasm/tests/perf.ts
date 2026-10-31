function print(message: string) {
  console.log(message);
}

const now = performance.now();

let count = 0;

for (let i = 0; i < 100000; i++) {
  // print(`C: ${i}`);
  count++;
}
print(`Count: ${count}`);


const end = performance.now();
console.log(`Time: ${end - now}ms`);