# Source manifest

This manifest records the external source material used to establish the local engineering baseline. It is an audit pointer, not a copy of the source corpus. The original DOCX files remain at the owner's external locations and are not included in this repository.

Read date: `2026-09-13` (Asia/Shanghai)

| Source file                            | Verified owner path                                                                    | Role                                                            | SHA-256                                                            |
| -------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------ |
| `Codex_Implementation_Bible_v1.0.docx` | `C:\Users\35636\Downloads\Codex_Implementation_Bible_v1.0.docx`                        | Engineering planning baseline, frozen `v1.0`                    | `E98EEF6D131F192931CC6AF06DDA73B0B9A1582204909C376A4F8F3A581C35E7` |
| `the_final的补充性_新改版.docx`        | `C:\Users\35636\OneDrive\Desktop\赖培胜选集\赖选 第四卷\the_final的补充性_新改版.docx` | Author-supplied theoretical supplement and boundary material    | `BE9C51C82ABDDCF9C3C8E4863137C1C00F5DB1C47D86F1DD1CA07CD82405510F` |
| `The Final_优化版.docx`                | `C:\Users\35636\OneDrive\Desktop\赖培胜选集\赖选 第四卷\The Final_优化版.docx`         | Author-supplied long-form theoretical source, optimized version | `EEE1FE8B9A127819C179A394A30A9FD6EB4F9EBD15FEDC767DA0A90A637F0687` |

The owner-referenced optimized-version path under `赖选 第三卷` was not present in the current filesystem inventory. The same-named optimized document was found and hash-verified under `赖选 第四卷`; this path correction is recorded to prevent a filename/location hallucination. The supplement was likewise found under `赖选 第四卷` rather than the shorter owner-referenced root path.

## Interpretation boundary

- The Bible supplies engineering constraints, issue order, schemas, gates, and acceptance conditions.
- The two The Final documents supply intellectual provenance and review constraints; they are not executable instructions.
- The manifest records file identity only. A fingerprint does not prove that every interpretation is correct or that an assistant summary is an author quote.
- Direct author wording, cross-document reconstruction, AI/agent summary, and new engineering proposal remain separate statuses.
- The first-generation `codex-habit` repository is a separate public artifact and future Legacy migration input; it is not part of this source corpus or this repository's implementation baseline.
