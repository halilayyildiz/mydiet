// Print a password hash for APP_PASSWORD_HASH: `npm run hash-password`.
// The password is typed hidden (or piped in as one line); only its scrypt hash is printed.
import { createInterface } from "node:readline";
import { hashPassword } from "./auth.ts";

function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Echo the prompt but not the characters typed after it.
    const r = rl as unknown as { _writeToOutput: (s: string) => void };
    r._writeToOutput = (s) => {
      if (s.includes(prompt)) process.stdout.write(prompt);
    };
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function readPiped(): Promise<string> {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data.split(/\r?\n/)[0];
}

let password: string;
if (process.stdin.isTTY) {
  password = await askHidden("Password: ");
  if ((await askHidden("Repeat password: ")) !== password) {
    console.error("Passwords don't match");
    process.exit(1);
  }
} else {
  password = await readPiped();
}
if (!password) {
  console.error("Empty password");
  process.exit(1);
}
console.log(await hashPassword(password));
