import { redirect } from "next/navigation";
import { signIn } from "@/lib/auth";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Sign in.
 *
 * Google is the only way in, and there is no password field anywhere in this
 * application. That is a deliberate reduction: a product about controlling who may
 * spend your money should not also be in the business of storing credentials.
 *
 * If Google is not configured yet, the page says so and says what to do about it,
 * rather than failing at the redirect with something unreadable.
 */
/** What each Auth.js error actually means for the person reading it. */
const SIGN_IN_ERRORS: Record<string, string> = {
  AccessDenied:
    "Google did not let that sign-in through. Try again, or use a different account.",
  Configuration:
    "Sign-in is misconfigured on the server, so this is not something you can fix from here. Check the server log for the underlying error.",
  OAuthAccountNotLinked:
    "That email address is already registered through a different sign-in method.",
  OAuthCallback: "Google returned an error on the way back. Try again.",
  Verification: "That sign-in link has already been used, or it expired.",
};

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const user = await currentUser();
  if (user) redirect("/");

  const sp = await searchParams;
  const errorParam = Array.isArray(sp.error) ? sp.error[0] : sp.error;

  const configured = Boolean(
    process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET,
  );

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-[440px] flex-col justify-center px-6 py-16">
      <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Sign in to Writ</h1>
      <p className="mt-2.5 text-[15px] leading-relaxed text-ink-mute">
        Writ lets you give an AI agent permission to spend a set amount, at shops you
        choose, for as long as you decide. You can take that permission back at any
        moment.
      </p>

      {errorParam && (
        <div className="mt-5 rounded-md border border-deny/25 bg-deny-wash px-3.5 py-2.5">
          <p className="text-[13px] leading-relaxed text-deny">
            {SIGN_IN_ERRORS[errorParam] ?? "Something went wrong signing you in."}
          </p>
          {/* The code, always. "Something went wrong" is useless to whoever has to
              fix it, and this page is the only place the reason surfaces. */}
          <p className="mt-1.5 font-mono text-[11px] text-deny/80">{errorParam}</p>
        </div>
      )}

      {configured ? (
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
          className="mt-7"
        >
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-3 rounded-md border border-line bg-surface px-4 py-3 text-[14px] font-medium transition-colors hover:border-line-strong"
          >
            <GoogleMark />
            Continue with Google
          </button>
        </form>
      ) : (
        <div className="mt-7 rounded-md border border-hold/25 bg-hold-wash px-4 py-3.5">
          <p className="text-[13px] font-medium text-hold">Google sign-in is not set up yet</p>
          <ol className="mt-2.5 list-decimal space-y-1.5 pl-4 text-[13px] leading-relaxed text-ink-mute">
            <li>
              In the Google Cloud console, create an OAuth client of type{" "}
              <span className="font-mono">Web application</span>.
            </li>
            <li>
              Add{" "}
              <span className="font-mono text-[12px]">
                http://localhost:3000/api/auth/callback/google
              </span>{" "}
              as an authorised redirect URI.
            </li>
            <li>
              Put the client id and secret in <span className="font-mono">.env</span> as{" "}
              <span className="font-mono text-[12px]">AUTH_GOOGLE_ID</span> and{" "}
              <span className="font-mono text-[12px]">AUTH_GOOGLE_SECRET</span>, then
              restart the server.
            </li>
          </ol>
        </div>
      )}

      <p className="mt-6 text-[12.5px] leading-relaxed text-ink-mute">
        Writ never sees a password. Signing in creates an account holding your name,
        email address and profile picture, and nothing else.
      </p>
    </div>
  );
}

/** Google's mark, drawn inline so the page loads no third-party asset. */
function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
