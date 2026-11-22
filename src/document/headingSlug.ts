export function headingSlug(text: string) {
  return text.trim().toLowerCase().normalize('NFKC').replace(/[^\p{Letter}\p{Number}\s_-]/gu, '').trim().replace(/\s+/g, '-') || 'section'
}
