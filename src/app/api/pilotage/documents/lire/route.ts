import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/api-auth'
import { corsHeaders, corsPreflight } from '@/lib/support-cors'
import { MESSAGE_LIMITE, finaliserLecture, lireComptes, natureDuDocument, preparerLecture, type Lecture } from '@/lib/documents-pilotage'
import { documentSuspect } from '@/lib/documents-pilotage-ia'
import { extraireTextePdf, garderDocument, lireParIA, quotaDuMembre } from '@/lib/documents-serveur'

// Un PDF de plusieurs pages lu par l'IA dépasse les 10 s par défaut d'une fonction Vercel.
export const maxDuration = 60

/**
 * Lecture d'un document du trader pour Pilotage (brief D1, 30/10/2026,
 * « Déposer mes documents »). UN document par appel, 4,5 Mo de corps au plus
 * (limite de Vercel) : le front boucle et montre la progression.
 *
 * POST { nom, type, data (base64), garder?, comptes?: [{ id, nom, firmName?, brokerName?, identifiants? }] }
 * rend { lecture, empreintes, document?, documentErreur?, quota }
 *
 * Dans l'ordre :
 * 1. sans IA : CSV de trades connus, Cash History de Tradovate (CSV et PDF),
 *    rapport Performance de Tradovate en PDF, Trader Dashboard, CSV aux
 *    colonnes devinées, relevé MetaTrader 4 en HTML, exports Quantower
 *    (exécutions et historique d'ordres appariés), relevé annuel d'eToro en
 *    PDF ; HEIC, RAR, ZIP, vidéos, classeurs : `illisible` avec la raison ;
 * 2. sinon l'IA, au moindre coût : le texte d'un PDF lisible ou d'un HTML
 *    (méthode texte, en tranches quand il est long : 4 appels au plus, une
 *    lecture comptée), le PDF ou l'image eux-mêmes seulement quand le texte
 *    manque (méthode vision) ;
 * 3. 5 lectures par l'IA par membre et par jour (Europe/Paris), l'équipe sans
 *    limite : au-delà, 429 et les lectures sans IA restent possibles ;
 * 4. le compte de Pilotage rapproché (`compteId`), et les empreintes des
 *    faits rendus (`empreintes`, `mouvements[].empreinte`,
 *    `releveBroker.empreinte`) : le même fait lu dans deux documents d'un
 *    dépôt (le CSV et le PDF d'un même rapport) a la même ;
 * 5. `garder` : l'original va au coffre (`document`), ou `documentErreur`
 *    dit pourquoi il n'y est pas (coffre plein, panne) ; la lecture est rendue
 *    dans les deux cas.
 *
 * Rien n'est écrit dans les données du membre ici : chaque fait lu est une
 * proposition que Pilotage fait valider (doctrine du 25/09).
 */

const METHODES = 'POST, OPTIONS'
/** Base64, en deçà de la limite de corps de Vercel (4,5 Mo). */
const TAILLE_MAX = 4_400_000

export async function OPTIONS(req: NextRequest) {
  return corsPreflight(req, METHODES)
}

export async function POST(req: NextRequest) {
  const cors = corsHeaders(req, METHODES)
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Non connecté.' }, { status: 401, headers: cors })

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Requête illisible.' }, { status: 400, headers: cors })
  }
  const nom = typeof body.nom === 'string' && body.nom.trim() ? body.nom.trim().slice(0, 200) : 'document'
  const type = typeof body.type === 'string' ? body.type.slice(0, 100) : ''
  // Une data URL (« data:application/pdf;base64,... ») est acceptée telle quelle.
  const data = typeof body.data === 'string' ? body.data.replace(/^data:[^,]{0,100},/, '').replace(/\s+/g, '') : ''
  if (!data) return NextResponse.json({ error: 'Document manquant.' }, { status: 400, headers: cors })
  if (data.length > TAILLE_MAX) {
    return NextResponse.json(
      { error: 'Document trop lourd (4,5 Mo au plus) : envoie-le en plusieurs fichiers, ou page par page.' },
      { status: 413, headers: cors },
    )
  }
  const octets = Buffer.from(data, 'base64')
  if (octets.length === 0) return NextResponse.json({ error: 'Document vide ou mal encodé.' }, { status: 400, headers: cors })
  const comptes = lireComptes(body.comptes)
  const garder = body.garder === true

  try {
    const etat = await quotaDuMembre(userId)
    let quota = etat.quota
    const nature = natureDuDocument(nom, type, octets)
    const textePdf = nature.famille === 'pdf' ? await extraireTextePdf(octets) : null
    const prep = preparerLecture({ nom, nature, octets, textePdf })

    let lecture: Lecture
    if ('lecture' in prep) {
      lecture = prep.lecture
    } else {
      if (!etat.autorise) return NextResponse.json({ error: MESSAGE_LIMITE, quota }, { status: 429, headers: cors })
      const lu = await lireParIA(userId, prep, nom, data)
      if ('erreur' in lu) {
        return NextResponse.json(
          { error: lu.erreur, quota, ...(lu.indisponible ? { indisponible: true } : {}) },
          { status: lu.statut, headers: cors },
        )
      }
      lecture = lu.lecture
      quota = { ...quota, lusParIaAujourdhui: quota.lusParIaAujourdhui + 1 }
      // Une consigne adressée à une IA dans le texte (jamais un IBAN, un BIC ni un reste d'extraction,
      // brief D3) : la lecture reste une proposition, mais le membre le voit.
      if (prep.ia === 'texte' && documentSuspect(prep.texte)) {
        lecture = {
          ...lecture,
          confiance: Math.min(lecture.confiance, 0.5),
          remarque: `[sécurité] Ce document contient du texte caché ou une consigne adressée à une IA : vérifie chaque fait avant de l'enregistrer. ${lecture.remarque}`.trim(),
        }
      }
    }

    const fin = finaliserLecture(lecture, comptes)
    const coffre = garder ? await garderDocument(userId, { nom, mime: nature.mime, octets, lecture: fin.lecture }) : null
    return NextResponse.json(
      {
        lecture: fin.lecture,
        empreintes: fin.empreintes,
        ...(coffre && 'document' in coffre ? { document: coffre.document } : {}),
        ...(coffre && 'erreur' in coffre ? { documentErreur: coffre.erreur } : {}),
        quota,
      },
      { headers: cors },
    )
  } catch (err) {
    console.error('[pilotage/documents/lire]', err)
    return NextResponse.json({ error: 'Lecture impossible pour le moment, réessaie.' }, { status: 500, headers: cors })
  }
}
