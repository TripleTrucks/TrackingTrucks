import "./SignInPage.css";

function SigninPage() {
    return (
        <main className="sign-in-page">
            <h1>Login</h1>

            <form onSubmit={(e) => e.preventDefault()}>
                <label>
                    Email
                    <input type="email" name="email" autoComplete="email" required />
                </label>

                <label>
                    Password
                    <input type="password" name="password" autoComplete="current-password" required />
                </label>

                <button type="submit">Sign In</button>
            </form>

            <a href="/">Back to TrackingTrucks</a>
        </main>
    );
}

export default SigninPage;