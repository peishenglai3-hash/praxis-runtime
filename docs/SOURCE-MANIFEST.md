# Source manifest

This manifest records the external source material used to establish the local engineering baseline. It is an audit pointer, not a copy of the source corpus. The original DOCX files remain at the owner's external locations and are not included in this repository.

Read date: `2026-09-13` (Asia/Shanghai)

| Source file                                    | Verified owner path                                                                                   | Role                                                                                     | SHA-256                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `Codex_Implementation_Bible_v1.0.docx`         | `C:\Users\35636\Downloads\Codex_Implementation_Bible_v1.0.docx`                                       | Engineering planning baseline, frozen `v1.0`                                             | `E98EEF6D131F192931CC6AF06DDA73B0B9A1582204909C376A4F8F3A581C35E7` |
| `the_final的补充性_新改版.docx`                | `C:\Users\35636\OneDrive\Desktop\赖培胜选集\赖选 第四卷\the_final的补充性_新改版.docx`                | Author-supplied theoretical supplement and boundary material                             | `BE9C51C82ABDDCF9C3C8E4863137C1C00F5DB1C47D86F1DD1CA07CD82405510F` |
| `The Final_优化版.docx`                        | `C:\Users\35636\OneDrive\Desktop\赖培胜选集\赖选 第四卷\The Final_优化版.docx`                        | Author-supplied long-form theoretical source, optimized version                          | `EEE1FE8B9A127819C179A394A30A9FD6EB4F9EBD15FEDC767DA0A90A637F0687` |
| `Codex_Phase3.5_Correction_Pack_v1.0.docx`     | `C:\Users\35636\Downloads\Codex_Phase3.5_Correction_Pack_v1.0.docx`                                   | Author Decision Freeze for Phase 3.5 correction work                                     | `FD35C2A9F1BBD52E965EBF024D5DD11DF96D7459BB5B3171B77A833DE299A6A9` |
| `The_Final_补充性扬弃Ⅱ_赖培胜_2026-09-14.docx` | `C:\Users\35636\OneDrive\Desktop\赖培胜选集\赖选 第四卷\The_Final_补充性扬弃Ⅱ_赖培胜_2026-09-14.docx` | Author-supplied revision of the theoretical constraint set (registered late — see below) | `38E0EE15B6B17917BEA0A17070F540FEC80757E027D721DA754B11FDC35709C6` |

## Registration history

The three files above whose paths begin `赖选 第四卷` sit in the same folder.
The manifest's first read date is `2026-09-13`; `The_Final_补充性扬弃Ⅱ` was
written `2026-09-14 11:59` and was **not** added when the manifest was next
touched. Phase 5 was then implemented on `2026-09-15/16` against a declared
constraint set of two documents while a third sat unread in the same folder.

That omission is recorded rather than repaired silently, because the document
it hid is not redundant: it explicitly supersedes the reading of the theory
that `docs/PHASE-5-GATE.md` had been citing, replacing
`错配 → 断点 → 反思` with
`错配 → 潜在断点 → 断点识别条件 → 是否被识别 → 反思`, and states that a
breakpoint does not automatically enter reflection. Its hash was verified on
`2026-09-16` and it is registered here in full. See `BP-050`.

A fingerprint records file identity. It does not show which document a decision
was actually made against, and the absence of this row for two days is the
evidence that the phase's theory review was made against an incomplete set.

The owner-referenced optimized-version path under `赖选 第三卷` was not present in the current filesystem inventory. The same-named optimized document was found and hash-verified under `赖选 第四卷`; this path correction is recorded to prevent a filename/location hallucination. The supplement was likewise found under `赖选 第四卷` rather than the shorter owner-referenced root path.

## Interpretation boundary

- The Bible supplies engineering constraints, issue order, schemas, gates, and acceptance conditions.
- The three The Final documents supply intellectual provenance and review
  constraints; they are not executable instructions. Where a later one
  supersedes an earlier formulation, the later one governs the reading, and a
  document that had not been read cannot be said to have constrained anything.
- The manifest records file identity only. A fingerprint does not prove that every interpretation is correct or that an assistant summary is an author quote.
- Direct author wording, cross-document reconstruction, AI/agent summary, and new engineering proposal remain separate statuses.
- The first-generation `codex-habit` repository is a separate public artifact and future Legacy migration input; it is not part of this source corpus or this repository's implementation baseline.
