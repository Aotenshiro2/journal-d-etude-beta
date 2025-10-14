import { NextRequest, NextResponse } from 'next/server'
import jsPDF from 'jspdf'
import { NoteData } from '@/types'

export async function POST(request: NextRequest) {
  try {
    const { notes } = await request.json() as { notes: NoteData[] }
    
    const pdf = new jsPDF()
    const pageHeight = pdf.internal.pageSize.height
    const pageWidth = pdf.internal.pageSize.width
    const margin = 20
    let yPosition = margin
    
    pdf.setFontSize(20)
    pdf.text('Journal d\'Études', margin, yPosition)
    yPosition += 20
    
    pdf.setFontSize(12)
    pdf.text(`Exporté le ${new Date().toLocaleDateString('fr-FR')}`, margin, yPosition)
    yPosition += 20
    
    notes.forEach((note, index) => {
      if (yPosition > pageHeight - 60) {
        pdf.addPage()
        yPosition = margin
      }
      
      pdf.setFontSize(14)
      pdf.setFont(undefined, 'bold')
      pdf.text(`${index + 1}. ${note.title}`, margin, yPosition)
      yPosition += 10
      
      pdf.setFont(undefined, 'normal')
      pdf.setFontSize(10)
      pdf.text(`Créé le: ${new Date(note.createdAt).toLocaleDateString('fr-FR')}`, margin, yPosition)
      yPosition += 10
      
      if (note.content) {
        pdf.setFontSize(11)
        const splitContent = pdf.splitTextToSize(note.content, pageWidth - 2 * margin)
        splitContent.forEach((line: string) => {
          if (yPosition > pageHeight - 30) {
            pdf.addPage()
            yPosition = margin
          }
          pdf.text(line, margin, yPosition)
          yPosition += 6
        })
      }
      
      yPosition += 10
      
      pdf.setDrawColor(200, 200, 200)
      pdf.line(margin, yPosition, pageWidth - margin, yPosition)
      yPosition += 10
    })
    
    const pdfBuffer = pdf.output('arraybuffer')
    
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=notes-${new Date().toISOString().split('T')[0]}.pdf`
      }
    })
  } catch (error) {
    console.error('Error generating PDF:', error)
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 })
  }
}