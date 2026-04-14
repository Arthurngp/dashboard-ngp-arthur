const fs = require('fs');
const files = [
  'app/comercial/gestao/page.tsx',
  'app/comercial/kpis/page.tsx',
  'app/comercial/propostas/page.tsx',
  'app/comercial/contratos/page.tsx',
  'app/comercial/page.tsx'
];

const replacement = `        sectorNav={[
          { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={15} height={15}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>, label: 'Gestão', href: '/comercial/gestao' },
          { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={15} height={15}><path d="M22 11.5C22 15.5 18.5 18 14 18c-4.5 0-8-2.5-8-6.5 0-1.5.5-3 1.5-4l.5-1c.5-.5 1-1 1.5-1s1 .5 1.5 1l.5 1c1 1 1.5 2.5 1.5 4z"/><path d="M12 2v20"/><path d="M12 12h10"/></svg>, label: 'Pipeline', href: '/comercial/pipeline' },
          { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={15} height={15}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>, label: 'Propostas', href: '/comercial/propostas' },
          { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={15} height={15}><path d="M16 2C16 2 12 6 12 6s-4-4-4-4"/><path d="M20 2C20 2 16 6 16 6s-4-4-4-4"/><path d="M12 18C12 18 8 22 8 22s-4-4-4-4"/><path d="M16 18C16 18 12 22 12 22s-4-4-4-4"/><path d="M12 6v12"/></svg>, label: 'Contratos', href: '/comercial/contratos' },
          { icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={15} height={15}><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>, label: 'Metas e KPIs', href: '/comercial/kpis' },
        ]}`;

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  // Match sectorNav={[ ... ]}
  content = content.replace(/sectorNav=\{\[[\s\S]*?\]\}/, replacement);
  fs.writeFileSync(file, content);
  console.log(`Updated ${file}`);
}
