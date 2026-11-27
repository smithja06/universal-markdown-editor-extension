# Third-party notices for Folio Markdown Editor

Folio's own code is licensed under MIT. The components listed here and in `dist/webview/THIRD_PARTY_NOTICES.md` retain their own licenses. The generated file records the detected packages and their available license texts, including EPL 2.0, Apache 2.0, and the SIL Open Font License.

## Eclipse Layout Kernel and its compiled runtime

Mermaid 12.3.0 loads elkjs 0.12.1 for ELK layouts. Folio bundles and minifies the upstream JavaScript, which already contains Java code compiled by GWT. The relevant upstream source is available under the licenses below. Download the source archives or source JARs from these links.

- **elkjs 0.12.1 and Eclipse Layout Kernel 0.12.1, EPL 2.0.** Copyright (c) 2017 and 2021 Kiel University and others for the elkjs wrappers. ELK content is the property of the respective authors or their employers. Eclipse Layout Kernel is a trademark of the Eclipse Foundation. The upstream notices also identify GPL 3.0 or later as a secondary license when the EPL conditions are met. [elkjs sources and build instructions](https://github.com/kieler/elkjs/tree/624ae90aa37110033a8af59c5ccbb292708b4317) · [elkjs source archive](https://codeload.github.com/kieler/elkjs/tar.gz/624ae90aa37110033a8af59c5ccbb292708b4317) · [ELK source archive](https://codeload.github.com/eclipse-elk/elk/tar.gz/3aa3b9fb98d8f9a41285b3061cff5efe79ed2ba4) · [ELK upstream notices](https://github.com/eclipse-elk/elk/blob/3aa3b9fb98d8f9a41285b3061cff5efe79ed2ba4/NOTICE.md)
- **EMF GWT common and ecore 2.12.4, EPL 1.0.** Copyright (c) 2002–2010 IBM Corporation and others, among the copyright notices in the sources. The full license is in `EPL-1.0.txt`. [emf-common sources](https://repo.maven.apache.org/maven2/com/genmymodel/emf/gwt/emf-common/2.12.4/emf-common-2.12.4-sources.jar) · [emf-ecore sources](https://repo.maven.apache.org/maven2/com/genmymodel/emf/gwt/emf-ecore/2.12.4/emf-ecore-2.12.4-sources.jar)
- **Eclipse Xtext Xbase runtime 2.36.0, EPL 2.0.** Copyright (c) itemis AG and others, as identified by each source file. The source JAR includes the Eclipse notice for the plug-in. [Xbase library sources and notice](https://repo.maven.apache.org/maven2/org/eclipse/xtext/org.eclipse.xtext.xbase.lib/2.36.0/org.eclipse.xtext.xbase.lib-2.36.0-sources.jar)
- **GWT user runtime 2.13.0 and Guava GWT 31.1-jre, Apache 2.0.** Copyright Google Inc., the GWT Project Authors, the Guava Authors and other contributors as identified in the sources. Neither source JAR includes an Apache NOTICE file. [GWT sources](https://repo.maven.apache.org/maven2/org/gwtproject/gwt-user/2.13.0/gwt-user-2.13.0-sources.jar) · [Guava GWT sources](https://repo.maven.apache.org/maven2/com/google/guava/guava-gwt/31.1-jre/guava-gwt-31.1-jre-sources.jar)
- **Unicode CLDR locale data, Unicode License V3.** GWT's i18n runtime classes compiled into the worker, such as `DateTimeFormatInfoImpl`, are based on Unicode CLDR data. The license follows.


```text
UNICODE LICENSE V3

COPYRIGHT AND PERMISSION NOTICE

Copyright © 1991-2023 Unicode, Inc.

NOTICE TO USER: Carefully read the following legal agreement. BY
DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a
copy of data files and any associated documentation (the "Data Files") or
software and any associated documentation (the "Software") to deal in the
Data Files or Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, and/or sell
copies of the Data Files or Software, and to permit persons to whom the
Data Files or Software are furnished to do so, provided that either (a)
this copyright and permission notice appear with all copies of the Data
Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall
not be used in advertising or otherwise to promote the sale, use or other
dealings in these Data Files or Software without prior written
authorization of the copyright holder.

The EPL 2.0 text is in `EPL-2.0.txt` (copied from the elkjs 0.12.1 package) and the EPL 1.0 text in `EPL-1.0.txt`. Folio selects the EPL 2.0 for elkjs and ELK.

**Corresponding source.** `npm run source:companion` (scripts/elk-source-companion.mjs) downloads the pinned elkjs and ELK commits, the EMF GWT, Xtext Xbase, Guava GWT and GWT source JARs and the published elkjs package. It verifies each SHA-256 (and the lockfile integrity for the npm package) and writes `folio-elk-source-companion.zip` with build instructions, the licenses, Folio's lockfile and build configuration, and the hash of the packaged ELK chunk. The `.melk` option sources and the MELK generator source are in the ELK archive. The generator itself is a build tool and is not distributed. Before any public distribution, host that archive at a durable public URL beside the release and record the URL here. Until then the archive is local only.

## PDF viewer and export

The PDF viewer bundles pdf.js (pdfjs-dist 6.5.438, Apache 2.0, Copyright Mozilla Foundation and contributors) and runs its worker from a bundled blob. PDF export runs pdfmake 0.3.14's prebuilt browser bundle (MIT) in an isolated worker. That bundle contains pdfkit, fontkit, linebreak and other MIT, ISC, BlueOak 1.0.0, BSD-3-Clause and Apache 2.0 components. Exported PDFs embed subsets of the Roboto fonts (Apache 2.0, Copyright 2011 Google Inc.) and DejaVu Sans and DejaVu Sans Mono 2.37 (Bitstream Vera and Arev font licenses, DejaVu changes in the public domain). The full list, versions and license texts are in `dist/PDF_THIRD_PARTY_NOTICES.txt`.

## Spreadsheet runtime

Folio uses the MIT option for IronCalc XLSX 0.9.1. The complete engine notice, published Rust dependency notices and Unicode CLDR license accompany the WASM in dist/SPREADSHEET_THIRD_PARTY_NOTICES.txt.

## DOMPurify

DOMPurify 3.4.18 is dual-licensed. This package uses it under Apache 2.0. Copyright (c) Cure53 and other contributors. The generated notices include the Apache 2.0 text. Folio bundles and minifies the published module. [Upstream license](https://github.com/cure53/DOMPurify/blob/37abc335c6a0aad2ac4f9dce6bd256d40c17acc4/LICENSE)

## MIT-licensed material

- Tailwind CSS 4.3.5 stylesheet inputs. Copyright (c) Tailwind Labs, Inc.
- FastDom 1.0.12, patched and bundled by Mermaid. Copyright (c) 2016 Wilson Page <wilsonpage@me.com>. [Mermaid's patch](https://github.com/mermaid-js/mermaid/blob/2086904e76c692331e34a45d7cc3bc30860d040e/patches/fastdom.patch)
- `format` 0.2.2. Copyright 2010–2014 Sami Samhuri <sami@samhuri.net>.
- `rehype-katex` 7.0.1 and `remark-math` 6.0.0. Copyright (c) 2017 Junyoung Choi <fluke8259@gmail.com>. [rehype-katex upstream license](https://github.com/remarkjs/remark-math/blob/88a9497e1ede93b958237c85edbf5651faeca7af/license) · [remark-math upstream license](https://github.com/remarkjs/remark-math/blob/d5d0660b150810a535bbb07eac6cc96a4510aa24/license)
- Inlined Babel helpers in upstream JavaScript. Copyright (c) 2014–present Sebastian McKenzie and other contributors. [Babel upstream license](https://github.com/babel/babel/blob/main/LICENSE)
- The es-toolkit compatibility layer includes portions derived from Lodash. Copyright OpenJS Foundation and other contributors <https://openjsf.org/>. Based on Underscore.js, copyright Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors <http://underscorejs.org/>. See the [Lodash revision history](https://github.com/lodash/lodash) for individual contributions.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
