import { program } from "commander";
import { Connection } from "ckb-vm-instruments";
import main from "async-main";

program
  .name("sp_check")
  .description("tools for checking SP register")
  .option("--port [port]", "Port to connect to", (port) => Number(port), 2000)
  .option("--address [address]", "Address to connect to", "localhost");
program.parse();
const opts = program.opts();

main(async () => {
  const c = await Connection.connect(`${opts.address}:${opts.port}`);

  let count = 0;
  await c.step(async function (inspector) {
    count++;
    return true;
  });

  console.log(`Executed instructions: ${count}`);
});
