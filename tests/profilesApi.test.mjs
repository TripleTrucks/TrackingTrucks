import assert from "node:assert/strict";
import test from "node:test";
import { registerOperator } from "../.cache/tests/profilesApi.js";

const details = {
  username: "test-operator",
  displayname: "Test Operator",
  password: "example-password",
  "phone-number": "",
};

test("registration posts the signup contract and does not retain the response", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ id: 1, ...details, role: "user" }), { status: 201 })
  );

  assert.equal(await registerOperator(details), undefined);
  assert.equal(fetchMock.mock.callCount(), 1);
  const [url, options] = fetchMock.mock.calls[0].arguments;
  assert.equal(url, "/api/Profiles/signup");
  assert.equal(options.method, "POST");
  assert.equal(options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(options.body), details);
});

test("registration reports backend validation errors", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ error: "Username already exists." }), { status: 409 })
  );
  await assert.rejects(registerOperator(details), { message: "Username already exists." });
});

test("registration handles a conflict without a JSON response", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("", { status: 409 }));
  await assert.rejects(registerOperator(details), /username is already taken/);
});

test("registration does not expose proxy HTML as an error message", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    new Response("<html>Bad gateway</html>", { status: 502 })
  );
  await assert.rejects(registerOperator(details), /couldn’t create your account/);
});

test("registration reports network failure and allows a retry", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("Failed to fetch");
  });
  await assert.rejects(registerOperator(details), /Check your connection and try again/);
  fetchMock.mock.mockImplementation(async () => new Response(null, { status: 201 }));
  await assert.doesNotReject(registerOperator(details));
});
