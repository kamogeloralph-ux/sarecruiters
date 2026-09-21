#!/usr/bin/env python3
"""Generate docs/SA-Recruiters-Terms-and-Conditions.pdf without any PDF library.
Builds a valid PDF 1.4 file (Helvetica) with word-wrapped text."""
import os

PAGE_W, PAGE_H = 595.28, 841.89  # A4
MARGIN = 64
LEAD = 15.5

def esc(s):
    return s.replace('\\', r'\\').replace('(', r'\(').replace(')', r'\)')

def wrap(text, width):
    out = []
    for para in text.split('\n'):
        if not para.strip():
            out.append('')
            continue
        line = ''
        for word in para.split():
            cand = (line + ' ' + word).strip()
            if len(cand) * 4.9 <= width or not line:
                line = cand
            else:
                out.append(line)
                line = word
        out.append(line)
    return out

DOC = [
    ('H1', 'SA Recruiters'),
    ('H2', 'Terms and Conditions of Use'),
    ('META', 'Effective date: 21 September 2026  |  Contact: admin@sarecruiters.co.za'),
    ('P', 'Welcome to SA Recruiters. These Terms and Conditions ("Terms") govern your access to and use of the SA Recruiters platform, including the SA Recruiters mobile application, the public directory of South African recruitment agencies and vacancies, and any related services (together, the "Platform"). By creating an account or signing in with Google, you agree to be bound by these Terms.'),
    ('H3', '1. About the Platform'),
    ('P', 'SA Recruiters is a free directory that connects job seekers with South African recruitment agencies, their branches, employers, and publicly advertised vacancies. We do not employ candidates, act as an agent of any agency or employer, or participate in any employment contract concluded between a candidate and an agency or employer.'),
    ('H3', '2. Eligibility and Accounts'),
    ('P', 'You must be at least 18 years old to use the Platform. Sign-in requires a valid Google account. You are responsible for maintaining the confidentiality of your Google account and for all activity that occurs under it. You must provide accurate information and keep it up to date. Notify us immediately of any unauthorised use of your account.'),
    ('H3', '3. Acceptable Use'),
    ('P', 'You agree not to: (a) use the Platform for any unlawful purpose; (b) harvest, scrape, or systematically extract directory data, vacancy listings, or contact details; (c) impersonate any person, agency, or employer; (d) submit false, misleading, or fraudulent vacancies or applications; (e) interfere with, overload, or attempt to gain unauthorised access to the Platform or its infrastructure; or (f) resell or commercially exploit the Platform or its content without our prior written consent.'),
    ('H3', '4. Vacancy Listings and Disclaimer'),
    ('P', 'Vacancy listings are supplied by participating agencies and employers or aggregated from publicly available sources. SA Recruiters does not guarantee that any listing is current, accurate, complete, or that applying will result in employment. Always exercise caution: never pay any person who claims to represent an agency or employer in exchange for a job offer, interview, or placement. Listings on the Platform are not an endorsement by SA Recruiters.'),
    ('H3', '5. Third-Party Websites and Applications'),
    ('P', 'The Platform may link to third-party websites, including agency and employer websites and external application forms. Your use of those websites is governed by their own terms and privacy policies. SA Recruiters is not responsible for the content, security, or practices of third-party websites.'),
    ('H3', '6. Intellectual Property'),
    ('P', 'The Platform, including its design, text, graphics, logos, and software, is owned by or licensed to SA Recruiters and is protected by South African and international intellectual property law. Agency names, employer names, brands, and vacancy content remain the property of their respective owners. You may view, download, and print content from the Platform for personal, non-commercial use only.'),
    ('H3', '7. Privacy and Personal Information'),
    ('P', 'We collect and process personal information (such as your Google account name, email address, and profile photo) to operate your account and the Platform, in accordance with our Privacy Policy and the Protection of Personal Information Act 4 of 2013 ("POPIA"). You may request access to, correction of, or deletion of your personal information by contacting us. Signing in with Google grants you a personal, revocable, non-exclusive licence to use the Platform.'),
    ('H3', '8. Disclaimer and Limitation of Liability'),
    ('P', 'The Platform is provided on an "as is" and "as available" basis without warranties of any kind, whether express or implied. To the maximum extent permitted by law, SA Recruiters, its owners, and its contributors will not be liable for any indirect, incidental, special, or consequential loss or damage (including loss of data, income, or opportunity) arising from your use of, or inability to use, the Platform or reliance on any listing or content on it.'),
    ('H3', '9. Termination'),
    ('P', 'We may suspend or terminate your access to the Platform at any time, with or without notice, if you breach these Terms or if we discontinue the service. On termination, your right to use the Platform ceases immediately. Sections 6 to 8 survive termination.'),
    ('H3', '10. Changes to These Terms'),
    ('P', 'We may update these Terms from time to time. The current version will always be available on the Platform, and continued use of the Platform after changes are published constitutes acceptance of the updated Terms.'),
    ('H3', '11. Governing Law'),
    ('P', 'These Terms are governed by the laws of the Republic of South Africa, and the courts of South Africa have exclusive jurisdiction over any dispute arising from them. If any provision of these Terms is found to be unenforceable, the remaining provisions remain in full force.'),
    ('P', 'Questions about these Terms can be sent to admin@sarecruiters.co.za.'),
]

def build():
    pages, cur = [], []
    y = PAGE_H - MARGIN
    for kind, text in DOC:
        if kind == 'H1':
            size, font, gap = 30, '/F2', 20
        elif kind == 'H2':
            size, font, gap = 16, '/F2', 14
        elif kind == 'H3':
            size, font, gap = 12.5, '/F3', 10
        elif kind == 'META':
            size, font, gap = 9.5, '/F1', 18
        else:
            size, font, gap = 10.5, '/F1', 9
        width = PAGE_W - 2 * MARGIN
        if kind == 'H1':
            lines = [text]
        else:
            factor = 1.05 if kind in ('H2', 'H3') else 1.0
            lines = wrap(text, width / (size * 0.499 * factor))
        for ln in lines:
            h = size + 4 if kind in ('H1', 'H2', 'H3') else LEAD
            if y - h < MARGIN:
                pages.append(cur); cur = []; y = PAGE_H - MARGIN
            y -= h
            cur.append(f"BT {font} {size} Tf {MARGIN} {y:.1f} Td ({esc(ln)}) Tj ET")
            if kind == 'H3':
                y += 3  # small extra space after headings
        y -= gap
    if cur: pages.append(cur)
    return pages

pages = build()
objs = ['<< /Type /Catalog /Pages 2 0 R >>']
kids = ' '.join(f'{4 + 2*i} 0 R' for i in range(len(pages)))
objs.append(f'<< /Type /Pages /Kids [{kids}] /Count {len(pages)} >>')
objs.append('<< /Font << /F1 '
            '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> /F2 '
            '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> /F3 '
            '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> >> >>')
for i, page in enumerate(pages):
    content = '\n'.join(page)
    objs.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W:.2f} {PAGE_H:.2f}] '
                f'/Resources 3 0 R /Contents {5 + 2*i} 0 R >>')
    objs.append(f'<< /Length {len(content)} >>\nstream\n{content}\nendstream')

out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'
offsets = []
for i, body in enumerate(objs, start=1):
    offsets.append(len(out.encode('latin-1')))
    out += f'{i} 0 obj\n{body}\nendobj\n'
xref_pos = len(out.encode('latin-1'))
out += f'xref\n0 {len(objs)+1}\n0000000000 65535 f \n'
for off in offsets:
    out += f'{off:010d} 00000 n \n'
out += (f'trailer\n<< /Size {len(objs)+1} /Root 1 0 R >>\n'
        f'startxref\n{xref_pos}\n%%EOF\n')

os.makedirs('docs', exist_ok=True)
with open('docs/SA-Recruiters-Terms-and-Conditions.pdf', 'wb') as f:
    f.write(out.encode('latin-1'))
print(f"Wrote docs/SA-Recruiters-Terms-and-Conditions.pdf ({len(out)} bytes, {len(pages)} pages)")
