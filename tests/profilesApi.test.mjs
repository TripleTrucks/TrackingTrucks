import assert from "node:assert/strict";
import test from "node:test";
import { registerOperator, login, logout, getCurrentAccount } from "../.cache/tests/profilesApi.js";

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
  assert.equal(options.headers["X-Requested-With"], "TrackingTrucks");
  assert.equal(options.credentials, "same-origin");
  assert.deepEqual(JSON.parse(options.body), details);
});

test("login uses the backend endpoint with cookie credentials", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => new Response("{}"));
  await login({ username: details.username, password: details.password });
  const [url, options] = fetchMock.mock.calls[0].arguments;
  assert.equal(url, "/api/auth/login");
  assert.equal(options.credentials, "same-origin");
  assert.equal(options.headers["X-Requested-With"], "TrackingTrucks");
  assert.deepEqual(JSON.parse(options.body), { username: details.username, password: details.password });
});

test("invalid login and rate limits are actionable errors", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 401 }));
  await assert.rejects(login(details), /Username or password is incorrect/);
  fetchMock.mock.mockImplementation(async () => new Response(null, { status: 429 }));
  await assert.rejects(login(details), /Try again in a minute/);
  await assert.rejects(registerOperator(details), /Try again in a minute/);
});

test("session restores only public account fields and handles expiry", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ id: 1, ...details })));
  assert.deepEqual(await getCurrentAccount(), { id: 1, username: details.username, displayname: details.displayname });
  assert.equal(fetchMock.mock.calls[0].arguments[1].cache, "no-store");
  fetchMock.mock.mockImplementation(async () => new Response(null, { status: 401 }));
  assert.equal(await getCurrentAccount(), null);
  fetchMock.mock.mockImplementation(async () => new Response("{}"));
  await assert.rejects(getCurrentAccount(), /Invalid session response/);
});

test("logout posts with the session cookie and reports failures", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 204 }));
  await logout();
  const [url, options] = fetchMock.mock.calls[0].arguments;
  assert.equal(url, "/api/auth/logout");
  assert.equal(options.method, "POST");
  assert.equal(options.credentials, "same-origin");
  assert.equal(options.headers["X-Requested-With"], "TrackingTrucks");
  fetchMock.mock.mockImplementation(async () => new Response(null, { status: 503 }));
  await assert.rejects(logout(), /Unable to log out/);
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
