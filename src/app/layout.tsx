import type { Metadata } from "next";
import { Instrument_Sans, IBM_Plex_Mono, Newsreader } from "next/font/google";
import { Nav } from "@/components/nav";
import { currentUser } from "@/lib/session";
import { signOut } from "@/lib/auth";
import "./globals.css";

/**
 * Three typefaces, three speakers. See the note at the top of globals.css — the split
 * is semantic, not decorative, and it is the one thing to preserve if this design is
 * ever revised.
 */

const sans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
  display: "swap",
});

const mono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

/** The human voice. Variable, with optical sizing, so it holds at 15px and at 28px. */
const serif = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Writ — bounded spending authority for AI buyers",
  description:
    "Signed, bounded, revocable spending mandates that let a merchant accept AI-agent traffic without accepting unbookable risk.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await currentUser();

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/sign-in" });
  }

  return (
    // The head script sets data-theme before React hydrates, so the attribute is always
    // on the client element and never in the server HTML. This exempts only <html> itself.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sans.variable} ${mono.variable} ${serif.variable} h-full antialiased`}
    >
      <head>
        {/*
          Runs before the first paint, so a viewer who chose light or dark never sees a
          frame of the other one. It only sets an attribute; the CSS does the rest, and
          an untouched preference falls through to prefers-color-scheme.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('writ-theme');" +
              "if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t}}catch(e){}",
          }}
        />
      </head>
      <body className="flex min-h-full flex-col">
        {/* Keyboard users land here first and can jump the navigation entirely. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-sm focus:bg-ink focus:px-3 focus:py-2 focus:text-ui focus:text-surface"
        >
          Skip to content
        </a>

        <Nav
          user={
            user ? { name: user.name, email: user.email, image: user.image } : null
          }
          signOutAction={signOutAction}
        />

        <main id="main" className="flex-1">
          {children}
        </main>
      </body>
    </html>
  );
}
