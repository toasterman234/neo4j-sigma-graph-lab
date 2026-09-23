import type { Metadata } from "next";
import { Provider } from "@/components/Provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Personal Knowledge Context Graph",
  description: "Personal note-taking, contact management, project tracking, and knowledge connections",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
