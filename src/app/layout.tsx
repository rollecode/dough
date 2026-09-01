import type { Metadata, Viewport } from "next";
import { Google_Sans, Zalando_Sans_Expanded } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import "@/styles/index.css";

const googleSans = Google_Sans({
  variable: "--font-google-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

// Logo wordmark only.
const zalandoExpanded = Zalando_Sans_Expanded({
  variable: "--font-zalando-expanded",
  subsets: ["latin"],
  weight: ["600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Dough",
  description: "AI-powered personal finance advisor",
  manifest: "/manifest.json",
  icons: {
    icon: "/favicon.png",
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180" },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Dough",
  },
};

export const viewport: Viewport = {
  themeColor: "#060912",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${googleSans.variable} ${zalandoExpanded.variable}`}>
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
