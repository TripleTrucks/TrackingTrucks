export interface RegistrationDetails {
  username: string;
  displayname: string;
  password: string;
  "confirm-password": string;
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
  const normalized = {
    ...details,
    username: details.username.trim(),
    displayname: details.displayname.trim(),
    "phone-number": details["phone-number"].trim(),
  };
  if (!/^[A-Za-z0-9._@+-]{1,50}$/.test(normalized.username)) {
    throw new Error("Username must be 1–50 characters: letters, numbers, or . _ @ + -");
  }
  if (!normalized.displayname || normalized.displayname.length > 100 ||
      [...normalized.displayname].some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || (code >= 127 && code <= 159);
      })) {
    throw new Error("Enter a display name of 1–100 characters without control characters.");
  }
  if (!details.password.trim() || details.password.length < 8 || details.password.length > 1024) {
    throw new Error("Password must be between 8 and 1024 characters.");
  }
  if (details.password !== details["confirm-password"]) throw new Error("Your passwords don’t match.");
  const phone = normalized["phone-number"];
  const digits = phone.replace(/\D/g, "");
  if (phone.length > 30 || (phone && (!/^[0-9+(). -]+$/.test(phone) || digits.length < 7 || digits.length > 15))) {
    throw new Error("Enter a phone number with 7–15 digits, or leave it blank.");
  }
  let response: Response;
  try {
    response = await fetch("/api/Profiles/signup", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Requested-With": "TrackingTrucks" },
      body: JSON.stringify(normalized),
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
