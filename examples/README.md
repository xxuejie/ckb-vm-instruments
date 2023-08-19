# Usage

For now, this project requires ckb-debugger using [gdbstub](https://github.com/daniel5151/gdbstub) as the underlying gdb engine. You can build one yourself using the following command:

```
$ git clone https://github.com/nervosnetwork/ckb-standalone-debugger
$ cd ckb-standalone-debugger
$ cargo build --release --features=gdbstub_impl --package ckb-debugger
```

The compiled binary can be found at `./target/release/ckb-debugger`

When launching ckb-debugger, make sure to use `gdb` mode, for example:

```
ckb-debugger --bin carrot --gdb-listen localhost:2000 --mode gdb
```

You might need to build ckb-vm-instruments library first since the examples here use local dependency reference:

```
cd ..; npm run build
cd examples; npx yarn
```

Now you can use the examples included here, for JS examples:

```
node js/sp_check.js --binary carrot

node js/addrtrace.js --vm-addresses 0x11014 --vm-regs ra,a0
```

For TS examples, we need to compile them first:

```
npm run build
```

Now we can run the TS examples:

```
node ts_out/instcount.js
```
