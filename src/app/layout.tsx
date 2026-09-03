import type { Metadata } from "next";
import { Instrument_Sans, IBM_Plex_Mono } from "next/font/google";
import { Nav } from "@/components/nav";
import { currentUser } from "@/lib/session";
import { signOut } from "@/lib/auth";
import "./globals.css";

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
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <Nav
          user={
            user
              ? { name: user.name, email: user.email, image: user.image }
              : null
          }
          signOutAction={signOutAction}
        />
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
