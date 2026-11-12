export interface RegistrationDetails {
  username: string;
  displayname: string;
  password: string;
  "phone-number": string;
}

export async function login(details: { username: string; password: string }): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Requested-With": "TrackingTrucks" },
      body: JSON.stringify(details),
    });
  } catch {
    throw new Error("Unable to connect. Check your connection and try again.");
  }
  if (response.status === 401) throw new Error("Username or password is incorrect.");
  if (response.status === 429) throw new Error("Too many attempts. Try again in a minute.");
  if (!response.ok) throw new Error("Unable to sign in. Please try again.");
}

export async function registerOperator(details: RegistrationDetails): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/Profiles/signup", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Requested-With": "TrackingTrucks" },
      body: JSON.stringify(details),
    });
  } catch {
    throw new Error("Unable to connect. Check your connection and try again.");
  }

  if (!response.ok) {
    if (response.status === 429) throw new Error("Too many attempts. Try again in a minute.");
    let message = response.status === 409
      ? "That username is already taken. Please choose another."
      : "We couldn’t create your account. Please try again.";
    try {
      const body: unknown = await response.json();
      if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") {
        message = body.error;
      }
    } catch {
      // A proxy or unavailable service may return an HTML error page.
    }
    throw new Error(message);
  }
}

export interface Account {
  id: number;
  username: string;
  displayname: string;
}

export async function getCurrentAccount(signal?: AbortSignal): Promise<Account | null> {
  const response = await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store", signal });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("Unable to check your session.");
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null ||
      !("id" in body) || typeof body.id !== "number" ||
      !("username" in body) || typeof body.username !== "string" ||
      !("displayname" in body) || typeof body.displayname !== "string") {
    throw new Error("Invalid session response.");
  }
  return { id: body.id, username: body.username, displayname: body.displayname };
}

export async function logout(): Promise<void> {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
    headers: { "X-Requested-With": "TrackingTrucks" },
  });
  if (!response.ok) throw new Error("Unable to log out. Try again.");
}
