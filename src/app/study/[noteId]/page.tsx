import { redirect } from 'next/navigation'

export default async function StudyNoteRedirect({ params }: { params: Promise<{ noteId: string }> }) {
  const { noteId } = await params
  redirect(`/notes/${noteId}`)
}
