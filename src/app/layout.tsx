import type { Metadata, Viewport } from "next";
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

// Sans ça, le téléphone rend la page à ~980 px de large et dézoome tout : rien
// n'est jamais à la bonne taille. `viewportFit: cover` pour passer sous l'encoche
// (les barres basses reprennent la marge avec env(safe-area-inset-bottom)).
// On NE bloque PAS le zoom navigateur — le pinch du canvas est géré par React
// Flow sur son propre conteneur, il n'entre pas en conflit.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
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
