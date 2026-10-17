// Runs the built dist/plugin.mjs over stdio, one fresh process per call, like the PayBox sandbox.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { describe, test } from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

const artifact = resolve(import.meta.dirname, "../dist/plugin.mjs");
const MERCHANT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const SENDER = "4zRUfp3pKZ83JDY9qFbLerx3oo6NhGmUQfuy8GByrMBk";
const USDC_LINK = `solana:${MERCHANT}?amount=1&spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&label=Mama%27s%20Kitchen&memo=order-1042`;

async function rpc(method: string, params: Record<string, unknown>) {
  const child = spawn(process.execPath, [artifact], { stdio: ["pipe", "pipe", "pipe"], env: { PATH: process.env.PATH ?? "" } });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const started = Date.now();
  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0", id: 1, method,
    params: { ...params, _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": { name: "scanpay-test", version: "1" },
      "io.modelcontextprotocol/clientCapabilities": {},
    } },
  })}\n`);
  const message = await new Promise<any>((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`timeout; stderr: ${stderr}`)), 10_000);
    child.stdout.on("data", () => {
      for (const line of stdout.split("\n")) {
        if (!line.trim()) continue;
        const parsed = JSON.parse(line);
        if (parsed.id === 1) {
          clearTimeout(timer);
          done(parsed);
        }
      }
    });
  });
  child.kill();
  assert.equal(stderr, "", "nothing logged on a normal call");
  assert.ok(Date.now() - started < 5_000, "call finishes well inside the 10 s budget");
  assert.equal(message.result?.resultType, "complete");
  return message.result;
}

const tools = new Map<string, any>();
async function call(name: string, args: Record<string, unknown>) {
  const result = await rpc("tools/call", { name, arguments: args });
  if (!result.isError) {
    const validate = new Ajv2020({ strict: false, validateFormats: false }).compile(tools.get(name).outputSchema);
    assert.ok(validate(result.structuredContent), `output matches declared schema: ${JSON.stringify(validate.errors)}`);
  }
  return result;
}

describe("bundled plugin over MCP", () => {
  test("lists four tools with 2020-12 schemas", async () => {
    const result = await rpc("tools/list", {});
    for (const tool of result.tools) tools.set(tool.name, tool);
    assert.deepEqual([...tools.keys()].sort(), ["create_payment_request", "pay_base_request", "pay_solana_request", "read_payment_request"]);
    for (const tool of tools.values()) {
      assert.equal(tool.inputSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
      assert.equal(tool.outputSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
      assert.ok(!JSON.stringify(tool).includes('"$ref"'), `${tool.name} schemas are self-contained`);
    }
    assert.deepEqual(tools.get("pay_solana_request").inputSchema.required.sort(), ["link", "sender"]);
  });

  test("read_payment_request", async () => {
    const result = await call("read_payment_request", { link: USDC_LINK });
    assert.equal(result.structuredContent.summary, `Pay 1 USDC to Mama's Kitchen (7xKX…gAsU) on Solana, memo: order-1042. Full recipient address: ${MERCHANT}.`);
  });

  test("pay_solana_request returns a Solana proposal", async () => {
    const result = await call("pay_solana_request", { link: USDC_LINK, sender: SENDER });
    assert.equal(result.structuredContent["io.paybox/transactionProposal"].kind, "solana");
  });

  test("pay_base_request returns an EVM proposal", async () => {
    const result = await call("pay_base_request", { link: "ethereum:0x70997970C51812dc3A010C7d01b50e0d17dc79C8@8453?value=1e15" });
    assert.deepEqual(result.structuredContent["io.paybox/transactionProposal"].transaction, {
      to: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", value: "1000000000000000", data: "0x",
    });
  });

  test("create_payment_request returns a link and a PNG QR", async () => {
    const result = await call("create_payment_request", { network: "solana", recipient: MERCHANT, amount: "1", label: "Mama's Kitchen" });
    assert.equal(result.structuredContent.qrCode, "included");
    const image = result.content.find((block: any) => block.type === "image");
    assert.equal(image.mimeType, "image/png");
    assert.ok(image.data.length < 20_000, `QR stays small (${image.data.length} base64 chars)`);
  });

  test("errors come back as isError results, not protocol errors", async () => {
    const result = await call("pay_solana_request", { link: `solana:${MERCHANT}?spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, sender: SENDER });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /never guesses/);
  });
});
