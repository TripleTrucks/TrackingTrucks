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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(details),
    });
  } catch {
    throw new Error("Unable to connect. Check your connection and try again.");
  }
  if (response.status === 401) throw new Error("Username or password is incorrect.");
  if (!response.ok) throw new Error("Unable to sign in. Please try again.");
}

export async function registerOperator(details: RegistrationDetails): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/Profiles/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(details),
    });
  } catch {
    throw new Error("Unable to connect. Check your connection and try again.");
  }

  if (!response.ok) {
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
