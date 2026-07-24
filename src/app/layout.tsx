import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Serif, Space_Grotesk, Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/contexts/ThemeContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Police de marque des écrans d'accueil (design system AOKnowledge, cf. sites v3) :
// titres = Noto Serif, corps = Space Grotesk, labels = Inter. Chargées ici comme
// variables CSS mais appliquées UNIQUEMENT sur la landing (l'intérieur de l'app reste Geist).
const notoSerif = Noto_Serif({
  variable: "--font-noto-serif",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AOKnowledge — Journal d'Études",
  description: "Transforme tes notes en apprentissage actif structuré.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body className={`${geistSans.variable} ${geistMono.variable} ${notoSerif.variable} ${spaceGrotesk.variable} ${inter.variable} antialiased`}>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
