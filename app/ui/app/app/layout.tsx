import type { Metadata, Viewport } from "next";
import { RegisterWebviewReady } from "@/components/native/RegisterWebviewReady";
import { RegisterServiceWorker } from "@/components/pwa/RegisterServiceWorker";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ollama",
  description: "A local-first Ollama chat app for desktop and mobile.",
  applicationName: "Ollama",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/ollama-icon-192.png", sizes: "192x192", type: "image/png" }
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }]
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Ollama"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  colorScheme: "dark",
  themeColor: "#11110f"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <RegisterServiceWorker />
        <RegisterWebviewReady />
        {children}
      </body>
    </html>
  );
}
