const { program } = require("commander");
const { Connection } = require("ckb-vm-instruments");
const main = require("async-main").default;

program
  .name("sp_check")
  .description("tools for checking SP register")
  .option("--port [port]", "Port to connect to", (port) => Number(port), 2000)
  .option("--address [address]", "Address to connect to", "localhost")
  .option("--binary [binary]", "Binary to deduce elf end");
program.parse();
const opts = program.opts();

main(async () => {
  const c = await Connection.connect(`${opts.address}:${opts.port}`);

  let minimum_sp = BigInt("0xFFFFFFFFFFFFFFFF");
  await c.step(async function (inspector) {
    const sp = await inspector.reg("sp");
    if (sp < minimum_sp) {
      minimum_sp = sp;
    }
    return true;
  });

  console.log(`Minimal SP: 0x${minimum_sp.toString(16)}`);

  if (opts.binary) {
    const fs = require("fs");
    const elf_tools = require("elf-tools");

    const elf_bytes = fs.readFileSync(opts.binary);
    const elf = elf_tools.parse(elf_bytes);

    let elf_end = BigInt(0);
    for (const { header } of elf.programs) {
      if (header.type === "load") {
        const current_end = BigInt(header.paddr) + BigInt(header.memsz);
        if (current_end > elf_end) {
          elf_end = current_end;
        }
      }
    }

    console.log(`ELF end: 0x${elf_end.toString(16)}`);
    if (minimum_sp - elf_end <= BigInt(0x1000)) {
      console.log(
        "WARNING: Minimal SP is only less than a page larger than ELF end!"
      );
    }
  }
});
