import fs from "fs";
import net from "net";
import PromiseSocket from "promise-socket";

const PACKET_SIZE = 1024;
const ACK = Buffer.from("+");
const INVALID_ACK = Buffer.from("-");
const OK = Buffer.from("OK");
const CONNECTION_STATUS = Buffer.from(
  "qSupported:swbreak+;hwbreak+;vContSupported+;no-resumed+"
);
const REGS = [
  "zero",
  "ra",
  "sp",
  "gp",
  "tp",
  "t0",
  "t1",
  "t2",
  "s0",
  "s1",
  "a0",
  "a1",
  "a2",
  "a3",
  "a4",
  "a5",
  "a6",
  "a7",
  "s2",
  "s3",
  "s4",
  "s5",
  "s6",
  "s7",
  "s8",
  "s9",
  "s10",
  "s11",
  "t3",
  "t4",
  "t5",
  "t6",
  "pc",
];

function hex(n: number) {
  return ("0" + Number(n).toString(16)).slice(-2);
}

function get_checksum(data: Buffer) {
  let checksum = 0;
  for (const b of data) {
    checksum = (checksum + b) % 256;
  }
  return Buffer.from(hex(checksum));
}

function decode_reg(data: Buffer) {
  if (data.length != 16) {
    throw new Error(`Invalid buffer for register: ${data.toString()}`);
  }
  let binary_data = Buffer.from(data.toString(), "hex");
  return binary_data.readBigUInt64LE(0);
}

function decode_all_regs(data: Buffer) {
  if (data.length != 16 * REGS.length) {
    throw new Error(`Invalid buffer for register: ${data.toString()}`);
  }
  const result: Record<string, BigInt> = {};
  for (let i = 0; i < REGS.length; i++) {
    result[REGS[i]] = decode_reg(data.subarray(i * 16, i * 16 + 16));
  }
  return result;
}

function decode_run_length(data: Buffer) {
  const pieces = [];
  while (data.length > 0) {
    let star = 0;
    for (let i = 1; i < data.length - 1; i++) {
      if (data[i] == "*".charCodeAt(0)) {
        star = i;
        break;
      }
    }
    if (star > 0) {
      let repeated_byte = data[star - 1];
      let repeated_times = data[star + 1] - 29;
      let repeated = Buffer.alloc(repeated_times, repeated_byte);
      pieces.push(data.subarray(0, star));
      pieces.push(repeated);
      data = data.subarray(star + 2);
    } else {
      pieces.push(data);
      data = Buffer.alloc(0);
    }
  }
  return Buffer.concat(pieces);
}

export class Connection {
  #socket: PromiseSocket<net.Socket>;
  #buffer: Buffer;
  #send_ack: boolean;
  #remote_status: string;

  private constructor(socket: PromiseSocket<net.Socket>) {
    this.#socket = socket;
    this.#buffer = Buffer.alloc(0);
    this.#send_ack = true;
    this.#remote_status = "";
  }

  static async connect(path: string) {
    const socket = new PromiseSocket(new net.Socket());

    if (fs.existsSync(path)) {
      // UNIX Socket
      await socket.connect(path);
    } else {
      const parts = path.split(":");
      let address = "localhost";
      if (parts.length > 1) {
        address = parts[0];
      }
      const port = parseInt(parts.slice(-1)[0]!, 10);
      await socket.connect(port, address);
    }

    let c = new Connection(socket);

    c.#remote_status = (await c.call(CONNECTION_STATUS)).toString();
    if (c.#remote_status.includes("QStartNoAckMode+")) {
      await c.no_ack();
    }

    return c;
  }

  async reg(register_name: string | number) {
    let register_index: Number = REGS.length;
    if (typeof register_name === "string") {
      register_index = REGS.indexOf(register_name);
    } else {
      register_index = register_name;
    }
    return decode_reg(await this.call(`p${register_index.toString(16)}`));
  }

  async pc() {
    return await this.reg("pc");
  }

  async regs() {
    return decode_all_regs(await this.call("g"));
  }

  async memory(start: bigint | number, length: bigint | number) {
    let data = await this.call(`m${start.toString(16)},${length.toString(16)}`);
    return Buffer.from(data.toString(), "hex");
  }

  async instruction(pc: bigint | number) {
    const lower_bits = await this.memory(pc, 2);
    let higher_bits = Buffer.alloc(2, 0);
    if ((lower_bits[0] & 0x3) === 0x3) {
      higher_bits = await this.memory(BigInt(pc) + BigInt(2), 2);
    }
    const bits = Buffer.concat([lower_bits, higher_bits]);
    return bits.readUInt32LE(0);
  }

  async current_instruction() {
    const pc = await this.pc();
    return await this.instruction(pc);
  }

  async call(input: string | Buffer) {
    await this.send(input);
    return await this.receive();
  }

  async send(input: string | Buffer) {
    const data = Buffer.from(input);
    let checksum = get_checksum(data);
    const packet = Buffer.alloc(data.length + 4);
    packet[0] = "$".charCodeAt(0);
    data.copy(packet, 1);
    packet[data.length + 1] = "#".charCodeAt(0);
    checksum.copy(packet, data.length + 2);

    // console.log("Sending: ", packet.toString());

    await this.#socket.write(packet);

    if (this.#send_ack) {
      let packet = await this.receive();
      if (ACK.compare(packet) !== 0) {
        throw new Error(`Ack expected but received: ${packet.toString()}`);
      }
    }
  }

  async receive() {
    let packet = await this.try_parsing_packet();
    while (packet === undefined) {
      if (this.#buffer.length > PACKET_SIZE * 2) {
        throw new Error(
          `Quite some data are gathered but a packate cannot be parsed: ${this.#buffer.toString()}`
        );
      }
      let data = await this.#socket.read();
      if (!data && this.#buffer.length === 0) {
        throw new Error("Connection closed by remote peer!");
      }
      if (data) {
        this.#buffer = Buffer.concat([this.#buffer, Buffer.from(data!)]);
      }
      packet = await this.try_parsing_packet();
    }
    return packet;
  }

  async no_ack() {
    await this.send("QStartNoAckMode");
    await this.expect_ok();
    this.#send_ack = false;
  }

  async expect_ok() {
    const packet = await this.receive();
    if (OK.compare(packet) !== 0) {
      throw new Error(`Expected OK but ${packet.toString()} received!`);
    }
  }

  async disconnect() {
    await this.send("D");
    await this.#socket.destroy();
  }

  async step(fn: InspectFn) {
    const inspector = new BreakpointInspector(this);
    let reason = "";
    while (1) {
      reason = (await this.call("vCont;s")).toString();
      if (reason[0] === "W") {
        break;
      }
      if (!(await fn(inspector))) {
        return undefined;
      }
    }
    await this.disconnect();
    return parseInt(reason.substring(1), 16);
  }

  async at(addresses: Array<bigint | number>, fn: InspectFn) {
    for (const address of addresses) {
      await this.call(`Z0,${address.toString(16)},4`);
    }
    const inspector = new BreakpointInspector(this);
    let reason = "";
    while (1) {
      reason = (await this.call("vCont;c")).toString();
      if (reason[0] === "W") {
        break;
      }
      if (reason.includes("swbreak")) {
        if (!(await fn(inspector))) {
          return undefined;
        }
      }
    }
    await this.disconnect();
    return parseInt(reason.substring(1), 16);
  }

  private async try_parsing_packet() {
    if (this.#buffer.length > 0) {
      switch (this.#buffer[0]) {
        case "+".charCodeAt(0):
          {
            const result = this.#buffer.subarray(0, 1);
            this.#buffer = this.#buffer.subarray(1);
            return result;
          }
          break;
        case "-".charCodeAt(0):
          {
            const result = this.#buffer.subarray(0, 1);
            this.#buffer = this.#buffer.subarray(1);
            return result;
          }
          break;
        case "$".charCodeAt(0):
          {
            let found = 0;
            // Try finding # with 2 succeeding bytes for checksum
            for (let i = 1; i < this.#buffer.length - 2; i++) {
              if (this.#buffer[i] === "#".charCodeAt(0)) {
                found = i;
                break;
              }
            }
            if (found > 0) {
              const packet = this.#buffer.subarray(1, found);
              const checksum = this.#buffer.subarray(found + 1, found + 3);
              const expected_checksum = get_checksum(packet);
              if (expected_checksum.compare(checksum) !== 0) {
                if (this.#send_ack) {
                  await this.#socket.write(INVALID_ACK);
                }
                throw new Error(
                  `Invalid checksum ${checksum.toString()} for packet ${packet.toString()}, expected: ${expected_checksum.toString()}`
                );
              }
              this.#buffer = this.#buffer.subarray(found + 3);
              if (this.#send_ack) {
                await this.#socket.write(ACK);
              }
              return decode_run_length(packet);
            }
            return undefined;
          }
          break;
        default: {
          throw new Error(`Invalid packet data: ${this.#buffer.toString()}`);
        }
      }
    }
    return undefined;
  }
}

type InspectFn = (inspector: BreakpointInspector) => Promise<boolean>;

class BreakpointInspector {
  #c: Connection;

  constructor(c: Connection) {
    this.#c = c;
  }

  async reg(register_name: string | number) {
    return await this.#c.reg(register_name);
  }

  async pc() {
    return await this.#c.pc();
  }

  async regs() {
    return await this.#c.regs();
  }

  async memory(start: bigint | number, length: bigint | number) {
    return await this.#c.memory(start, length);
  }

  async instruction(pc: bigint | number) {
    return await this.#c.instruction(pc);
  }

  async current_instruction() {
    return await this.#c.current_instruction();
  }
}
