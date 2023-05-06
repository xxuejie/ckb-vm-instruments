# Usage

First, compile ckb-debugger code with changes in this [PR](https://github.com/nervosnetwork/ckb-standalone-debugger/pull/80).

When launching ckb-debugger, make sure to use `gdb` mode, for example:

```
ckb-debugger --bin carrot --gdb-listen localhost:2000 --mode gdb
```

Now you can use the examples included here, for JS examples:

```
node js/sp_check.js --binary carrot

node js/addrtrace.js --vm-address 0x11014 --vm-regs ra,a0
```

For TS examples, we need to compile them first:

```
npm run build
```

Now we can run the TS examples:

```
node ts_out/instcount.js
```
