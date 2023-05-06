const { program } = require("commander");
const { Connection } = require("ckb-vm-instruments");
const main = require("async-main").default;

program
  .name("sp_check")
  .description("tools for checking SP register")
  .option("--port [port]", "Port to connect to", (port) => Number(port), 2000)
  .option("--address [address]", "Address to connect to", "localhost")
  .requiredOption(
    "--vm-addresses [vm_addresses]",
    "Comma separated program addresses to trace"
  )
  .requiredOption("--vm-regs [regs]", "Comma separated registers to trace");
program.parse();
const opts = program.opts();

main(async () => {
  const c = await Connection.connect(`${opts.address}:${opts.port}`);

  const addresses = opts.vmAddresses.split(",").map((a) => BigInt(a));
  const regs = opts.vmRegs.split(",");
  await c.at(addresses, async function (inspector) {
    const pc = await inspector.pc();
    console.log(`At pc: 0x${pc.toString(16)}`);
    for (const reg of regs) {
      const value = await inspector.reg(reg);
      console.log(`  Register ${reg}: 0x${value.toString(16)}`);
    }
    return true;
  });
});
