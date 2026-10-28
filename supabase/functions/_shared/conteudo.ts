// Conteúdo dos PDFs (e-book e bônus), em blocos.
// O texto real é o produto pago e NÃO fica neste repositório público.
// A versão completa está publicada na função tombo-arquivos do Supabase.
// Para publicar de novo, cole aqui os blocos completos ANTES do deploy e não faça commit deles.
export const PDFS: Record<string, { kicker: string; titulo: string; sub: string; arquivo: string; blocos: any[] }> = {
  ebook: { kicker: "Guia pós-eleição 2026", titulo: "Depois do Tombo", sub: "O Método PRUMO para proteger, aproveitar e não errar no susto.", arquivo: "Depois-do-Tombo", blocos: [] },
  tesouro: { kicker: "Bônus · Guia prático", titulo: "Tesouro Direto na Prática", sub: "O passo a passo do seu primeiro investimento no Tesouro Direto e da sua reserva de emergência.", arquivo: "Tesouro-Direto-na-Pratica", blocos: [] },
  dolar: { kicker: "Bônus · Guia prático", titulo: "Dólar sem Susto", sub: "Como ter uma parte do seu dinheiro em dólar pela própria B3, sem comprar no pico.", arquivo: "Dolar-sem-Susto", blocos: [] },
};
