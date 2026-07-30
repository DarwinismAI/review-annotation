import assert from "node:assert/strict";
import { readJsonResponse } from "../../src/hooks/use-json-resource";

(async () => {
  await assert.rejects(
    () => readJsonResponse(new Response("", { status: 200, headers: { "content-type": "application/json" } })),
    /Không tải được dữ liệu từ máy chủ/,
  );

  await assert.rejects(
    () => readJsonResponse(new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } })),
    /Không tải được dữ liệu từ máy chủ/,
  );

  const payload = await readJsonResponse(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
  assert.deepEqual(payload, { ok: true });
})();
