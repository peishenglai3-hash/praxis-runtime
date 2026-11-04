# Repro manifest · W2026-45

本包为证据整理与候选diff，非新产品、可安装实验平台或已通过P1。仅白名单本目录四主件、evidence/三份JSON与两份diff可同步研究分支。所有执行日期与本周日期分开。两份公开H3文件现为规范排版衍生副本，不再沿用原字节身份；旧Lab原件未改，JSON解析后逐项内容相等。下表SHA为原件身份，公开副本SHA另列。

## 材料清单与可复核性

| 材料 / 精确版本或hash                                                                                                        | 合成/环境 / 独立判据                                                              | 公开资格 / 缺项 / 风险                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [BASELINE_RECEIPT](evidence/BASELINE_RECEIPT.json)，2026-11-04                                                               | 本周Git/文件摘要与公开GET查询；无behavior rerun                                   | 本人生成、无私密值，按仓库MIT供研究复核；只证明被检查快照与范围                                            |
| [H3旧收据](evidence/H3_RECEIPT_20261031.json)，SHA 16f1ffb2b877fbc01fdc2e5522542f4735e1fbccb543098526d412b62a24bf67          | 原日期10-31；X1复用10-30 Node24 domain，X2为Python3.14.3源码副本；含控制/源码清单 | 合成/公开源码证据；本周副本仅排版，旧原件未改；源hash与副本hash分列；不证明当前系统重新执行成功            |
| [X3旧收据](evidence/H3_X3_FLUSH_RECEIPT_20261031.json)，SHA bd057c8566a7c54b8077fee946187ebb2fce2cd8211a5e95932d2c4e24106173 | 10-31 Node24.15，合成HOME，原字节/两flush与批内控制                               | 仅无秘密合成数据；不含真实Habits；其前置hash对应H3.evidenceSanitization.beforeSha256，不误当现文件hash损坏 |
| 原G0-A EVIDENCE，hash 9d65e2aeacba378f629e18cf0db60cf228dc638e4fcca256380b393968024b4b                                       | 10-30 Node24.15/TS5.9.3/Zod4.1.5；9项domain、三种产物绑定负控制                   | 本周不复制整套Lab；必要输入/actual/expected已在H3.X1；不把恢复固定版脚本当P1评分                           |
| 旧checks.mjs，hash 67af1305eb5cd395254d3ede76834511c176a577a7dfa9ff862a528fa4490821                                          | 已更改解释器参数/脱敏接口，NOT_REEXECUTED_AFTER_CHANGE；本周不执行                | 留本地旧Lab，不打包成已验证公开runner；完整X3 flush步骤在独立收据，不在该脚本                              |
| [R01提案](evidence/R01_HABITAT_FAIL_CLOSED_PROPOSAL.diff)，H@c3be4af                                                         | 仅文本diff；NOT_APPLIED / NOT_RUN，无buffer/crash回归                             | 原公开MIT源码的小提案；若独立需另批；不能说数据完整性已修                                                  |
| [R02提案](evidence/R02_TFRK_MANDATORY_PROPOSAL.diff)，T@88fd112                                                              | 仅文本diff；CONTRACT_AMBIGUITY，NOT_APPLIED / NOT_RUN                             | 仅Owner选择MANDATORY后候选；无resume/approval身份，不声称完整审批                                          |
| D2-A比较、原始提示/输出                                                                                                      | 回顾性单对，真语料授权不包含本次公开；原成本不可作总体净效用                      | LOCAL_ONLY，未复制原始对话或候选卡；只公开受限结论与可检查的本地记录hash                                   |
| 三份本周合同、TFRK原DOCX                                                                                                     | 读取工程规范；非行为数据                                                          | 原件LOCAL_ONLY；不把阅读授权当再分发许可证；仅公布文件名/hash及必要段号                                    |
| 私人HOME/.praxis/local-only/聊天/ZIP/凭据/真实数据库                                                                         | 未读取/未导入                                                                     | NEVER_INCLUDE；本周无此类材料进入包                                                                        |

## 原合同来源哈希（原件不随包）

- Plan V1.0-RC：`f70d67615af1d41bf9e8e6a0eb4aed8bebeea26dc7f27b50dad0293c8ca9431c`。
- Execution Prompt：`2eb034bfb2a265aec0b262a5891fd641ccf96e05d822616b326a695e2a6d35a5`。
- AI Memory Engineer Addendum：`843b03dc267ccc69663992da49908510ea17bba219faf3ad85a3c847d6c64363`。
- The_Final_Runtime_Kernel_Engineering_Bible_V1.0.docx：`fe4f8fd77c8be694a9299f89502b69e087007e1d1a681068e50b44732958cd6a`；语义提取只读word/document.xml，Pxxxx按所有w:p顺序编号；未作视觉版式验收。

## 可从公开来源检查什么

H：[c3be4af源码](https://github.com/peishenglai3-hash/codex-habit/tree/c3be4af760e8e7ec2f27184584b1c949484305e0)。T：[88fd112源码](https://github.com/peishenglai3-hash/the_final-runtime-kernel/tree/88fd1123b1375573cbb2dc19fd3f58e23d2d11e3)。P：[公开main快照](https://github.com/peishenglai3-hash/praxis-runtime/tree/64137d3cccc8ae3cdd7f45a22ec5cbcdb55ee8df)。

可查对应函数、公开fixture/测试和本包收据中的输入/输出。两份旧收据的排版副本保留适用判据与控制；这不是现成的一键重放包：本地临时probe.py/构建产物不上传，本周没有为可移植性重新构建。公开读者可独立实现最小复验，但不能据此声称作者已在新机器重跑。没有运行/分发会自动写真实HOME的命令。

### 一次定点纠正：收据排版血缘

初次本目录Prettier检查退出1，准确指出两份H3 JSON副本；此失败保留，不写成初次全绿。只格式化本周新副本，原件仍在旧Lab。BASELINE_RECEIPT.legacyReceipts记录原拷贝时的源字节身份，不是下列最终公开副本身份。

| 文件                              | 原件SHA-256（旧Lab）                                             | 公开排版副本SHA-256                                              | JSON内容相等 |
| --------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- | ------------ |
| H3_RECEIPT_20261031.json          | 16f1ffb2b877fbc01fdc2e5522542f4735e1fbccb543098526d412b62a24bf67 | b68a489ce363427d8e2b72ef37a23502ce514d91caed1a25127b1a0546326b64 | true         |
| H3_X3_FLUSH_RECEIPT_20261031.json | bd057c8566a7c54b8077fee946187ebb2fce2cd8211a5e95932d2c4e24106173 | 4096f03bdf5b4a38a641530956e1567f53a75dddd40a3b360c23a76d5ddd8c40 | true         |

X3内部前置hash仍指排版前的历史链，不应被误改为新公开副本hash。这次改动不产生新行为验证；原始证据与排版副本仅在字节格式上不同。

C1修复6523390和当前d58c941为LOCAL_ONLY_COMMIT，远端未包含；不提供假装可访问的修复链接。公开研究分支父版本只含公开核心，故本地L3结果不能应用到该分支核心。

## GitHub同步与授权清单

负责人本条“同步GitHub”覆盖附件的默认不推送，仅用于9个白名单研究文件。拟创建 `codex/research-transition-w2026-45`，父提交 `64137d3cccc8ae3cdd7f45a22ec5cbcdb55ee8df`。最终远端commit/ref及同步结果以实际API读取和最后汇报为准，不把本文件自身写入未来commit SHA。

不上传旧Lab整体、原DOCX、附件原文、D2-A原文/ZIP/会话、任何数据库或未跟踪无关文件。不改main/release candidate/T/H的远端分支；无PR合并/Tag/Release。研究工件的公开不等于R01/R02被批准，也不等于C1维护发布。

## 门禁与退出

FENCE_HOST未知，P0仍待Owner；T合同待决，故两diff无新执行；P本地canonical NOT_RUN。匹配Node22.13/pnpm11.19的未来维护窗口需另批；不以安装依赖或降级门禁取得绿。P1/P2及模型主体不在本包执行范围。

冻结四主件的预审SHA交给独立Reviewer；原始意见附入Week Closure，若有一次定点修订，列出变更位置与受影响复核。公开前仅做范围/格式/路径/常见secret模式检查；不是对Git全历史或真实宿主安全的认证。
