import { redirect } from 'next/navigation'

// La carte des notes, c est le canvas d accueil — cette page etait redondante.
export default function CanvasRedirect() {
  redirect('/')
}
