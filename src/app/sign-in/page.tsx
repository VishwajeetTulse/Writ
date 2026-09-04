import Link from "next/link";
import { redirect } from "next/navigation";
import { signIn } from "@/lib/auth";
import { currentUser } from "@/lib/session";
import { buttonClass, linkClass } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Sign in.
 *
 * The one screen in the product that has to say what Writ is, because it is the only
 * one a stranger reaches first. It says it in three lines and then gets out of the way:
 * no hero, no feature grid, no illustration.
 *
 * Google is the only way in, and there is no password field anywhere in this
 * application. That is a deliberate reduction: a product about controlling who may
 * spend your money should not also be in the business of storing credentials.
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
    <div className="mx-auto flex min-h-[calc(100vh-52px)] max-w-[860px] flex-col justify-center px-5 py-16 sm:px-8">
      <div className="grid gap-12 md:grid-cols-[minmax(0,1fr)_minmax(0,300px)] md:items-start md:gap-16">
        <div>
          <div className="eyebrow mb-4">Bounded spending authority</div>

          <h1 className="human max-w-[16ch] text-hero font-normal leading-[1.08] tracking-[-0.022em]">
            Let an agent spend, without handing over the account.
          </h1>

          <p className="human mt-5 max-w-[52ch] text-lede leading-[1.6] text-ink-mute">
            A mandate names the shops your agent may buy from, caps what it may spend at
            once and in total, and expires on its own. Every request it makes is checked
            against those terms before any money moves, and you can withdraw the whole
            thing in one click.
          </p>

          <dl className="mt-9 grid gap-x-8 gap-y-5 border-t border-line pt-6 sm:grid-cols-3">
            <div>
              <dt className="eyebrow mb-1.5">Discovery</dt>
              <dd className="text-ui leading-snug text-ink-mute">
                Open. Any buyer can read the{" "}
                <Link href="/catalog" className={linkClass}>
                  catalog
                </Link>{" "}
                without an account.
              </dd>
            </div>
            <div>
              <dt className="eyebrow mb-1.5">Execution</dt>
              <dd className="text-ui leading-snug text-ink-mute">
                Gated. Every purchase needs a signed, unexpired mandate.
              </dd>
            </div>
            <div>
              <dt className="eyebrow mb-1.5">Record</dt>
              <dd className="text-ui leading-snug text-ink-mute">
                Permanent. Each decision is chained to the one before it.
              </dd>
            </div>
          </dl>
        </div>

        <div className="md:pt-14">
          {errorParam && (
            <div
              role="alert"
              className="mb-5 rounded-sm border border-deny/25 bg-deny-wash px-3.5 py-2.5"
            >
              <p className="text-ui leading-relaxed text-deny">
                {SIGN_IN_ERRORS[errorParam] ?? "Something went wrong signing you in."}
              </p>
              {/* The code, always. "Something went wrong" is useless to whoever has to
                  fix it, and this page is the only place the reason surfaces. */}
              <p className="mt-1.5 font-mono text-nano text-deny">{errorParam}</p>
            </div>
          )}

          {configured ? (
            <form
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: "/" });
              }}
            >
              <button
                type="submit"
                className={`${buttonClass("secondary", "lg")} w-full`}
              >
                <GoogleMark />
                Continue with Google
              </button>
            </form>
          ) : (
            <div className="rounded-sm border border-hold/25 bg-hold-wash px-4 py-3.5">
              <p className="text-ui font-medium text-hold">
                Google sign-in is not set up yet
              </p>
              <ol className="mt-2.5 list-decimal space-y-1.5 pl-4 text-ui leading-relaxed text-ink-mute">
                <li>
                  In the Google Cloud console, create an OAuth client of type{" "}
                  <span className="font-mono text-micro">Web application</span>.
                </li>
                <li>
                  Add{" "}
                  <span className="font-mono text-micro">
                    http://localhost:3000/api/auth/callback/google
                  </span>{" "}
                  as an authorised redirect URI.
                </li>
                <li>
                  Put the client id and secret in{" "}
                  <span className="font-mono text-micro">.env</span> as{" "}
                  <span className="font-mono text-micro">AUTH_GOOGLE_ID</span> and{" "}
                  <span className="font-mono text-micro">AUTH_GOOGLE_SECRET</span>, then
                  restart the server.
                </li>
              </ol>
            </div>
          )}

          <p className="mt-5 text-small leading-relaxed text-ink-soft">
            Writ never sees a password. Signing in creates an account holding your name,
            email address and profile picture, and nothing else.
          </p>
        </div>
      </div>
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
