# Praxis Research Transition · Week 2026-45

实际施工日：2026-11-04（Asia/Shanghai）。11-02/03 无补签操作。状态：四主件候选；Owner 尚未签收。唯一当前状态入口为本文件，历史结论只引用不覆盖。

**总风险：HOLD_FOR_P0 / P0_OWNER_ACTION_REQUIRED。** Habitat 仅取得本周施工范围的局部 FENCE，真实安装状态未知。TFRK 为 CONTRACT_AMBIGUITY；Praxis 为 LOCAL_FIXED / PUBLIC_UNFIXED / CANONICAL_OPEN。这些状态彼此独立。

## 合同、授权与完成顺序

已完整阅读本周 Plan、Execution Prompt、AI Memory Engineer Addendum；Plan 为主合同。采用已读取的 agent-governance 与 test-evidence-review 方法；GitHub 用已连接插件。独立 Reviewer 在四主件冻结后进入，不先参与撰写。

| WP  | 实际工作（均11-04）                                       | 结果 / 停止边界                                                                         |
| --- | --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 0   | 三仓 status/HEAD/branch/tree/文件摘要；旧五主件和收据核对 | NO_BASELINE_DRIFT；[BASELINE_RECEIPT](evidence/BASELINE_RECEIPT.json)；未清理未跟踪文件 |
| 1   | 本周文档警示与施工链禁止旧写入口；R01 仅 diff 草案        | FENCE_DOC / FENCE_PROJECT，FENCE_HOST UNKNOWN；P0不关闭                                 |
| 2   | 原 TFRK Bible 全文、源码/README/测试与X2逐项对照          | 合同有两种含义；R02仅条件性diff，未应用/未跑                                            |
| 3   | 公开分支查询、C1两端内容哈希、canonical条件               | local-fixed / public-unfixed / canonical-open；无新 domain/集成测试                     |
| 4   | 四主件与必要脱敏证据；论文声明、复现边界、公开白名单      | 准备完毕后冻结哈希，再接受独立后验审查                                                  |
| 5   | 按三仓提交Owner待签候选                                   | 只提出HOLD/带债收束建议；不批准后续施工                                                 |

附件默认禁止提交/推送；负责人本条直接要求“最新版本同步GitHub”，仅此项得到覆盖。同步范围限本目录的脱敏研究工件，目标 `codex/research-transition-w2026-45`，父版本为公开 main@64137d3。不得由当前本地分支直接推送而顺带带出6523390/d58c941，不合入main、不Tag/Release。候选diff不是已接受补丁，分支同步也不是Owner风险签收。

## WP-0 · 基线快照

三仓公开main本次通过GitHub插件GET branches核对（2026-11-04）；本地另用Git和实际文件哈希核对，不能相互代替。

| 根/位置                                                   | reported → observed SHA                         | branch / 工作树                                                                               | changed / 影响 / 下一动作            |
| --------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------ |
| P：本仓                                                   | d58c941f815b66eb00e2f4b742f87f6197c956e1 → 同值 | release/v0.1.0-preview-candidate；tracked无差异，上游ahead2；既有研究目录及一份无关文件未跟踪 | NO；只在本周Lab写研究记录            |
| H：本仓test-results/stage-closure-20261031/habitat-source | c3be4af760e8e7ec2f27184584b1c949484305e0 → 同值 | detached；19 tracked干净                                                                      | NO；只读公共源码，不执行写入口       |
| T：本仓相邻the-final-runtime                              | 88fd1123b1375573cbb2dc19fd3f58e23d2d11e3 → 同值 | main；31 tracked无差异；local-only/存在但不读                                                 | NO；只读合同/源码                    |
| P：公开main                                               | 64137d3cccc8ae3cdd7f45a22ec5cbcdb55ee8df → 同值 | 远端candidate仍21851cedcd09c8bf2b531fe38a37f38c5f0fe0e5                                       | NO；研究分支从公开main分出，核心仍旧 |

三仓工作树摘要与10-31参考一致，完整值见BASELINE_RECEIPT。旧Lab/研究审查共39文件冻结哈希；不沿来源链接读取私人聊天、ZIP、真实HOME、.praxis、local-only或凭据。

## WP-1 · Habitat FENCE_SCOPE

| 层级          | 实际采取及可核查范围                                                                                                                                | 状态 / 不能推导的结论                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| FENCE_DOC     | 本页及Claims H-01明确禁止本项目执行风险写入口，保留X3覆盖结果和Owner动作                                                                            | IMPLEMENTED文档警示；不代表代码修复                                    |
| FENCE_PROJECT | 本周执行集合仅Git只读、公开元数据GET、工程文档解析、哈希/格式、写本Lab和获准的研究分支同步；排除capture/flush/install/hook/H3脚本执行，源码原件不改 | 本周实际施工链未调用旧入口；这是作业范围控制，不是OS级禁止其他进程运行 |
| FENCE_HOST    | 未检查HOME、插件/Hook配置、服务、生产日志，也未禁用任何宿主对象                                                                                     | UNKNOWN / NOT_AUTHORIZED；不能声称所有安装实例停止写入                 |

P0仍为OWNER_ACTION_REQUIRED。负责人可另行选择：授权只看安装/启用元数据的宿主核查（先明确目录和允许字段），再决定是否停用；或另批R01合成副本修复与恢复验证。当前不索要真实数据，不自动查看配置，不以“原型已旧”代替停用证据。

[R01提案](evidence/R01_HABITAT_FAIL_CLOSED_PROPOSAL.diff)只增加exclusive-create，不覆盖原文件；未应用、未执行。它会在同名冲突时失败，不能单独保证连续flush可用性、崩溃原子性、重试恢复或索引/文件一致性。buffer保全仅是当前代码顺序推断，NOT_TESTED。另批后至少验两次flush、同批两条、同名冲突、写异常后的buffer/索引；若需新平台则ABORT_PATCH+FENCE。

## WP-2 · TFRK CONTRACT_DECISION_NEEDED

重新完整读取原Engineering Bible V1.0（DOCX，hash见Repro；段号按document.xml所有w:p顺序）。本次新证据使上轮的“human gate失败”解释必须收窄，旧X2观察值不变。

| 规范/实现                                       | 直接支持的事实                                                                | 尚不能决定什么                            |
| ----------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------- |
| Bible §5.3，P0130                               | human re-entry须有显式EvidenceRef/Event                                       | 未定义每个human路由都必须等待一次re-entry |
| Bible §6.3，P0144–0147                          | human是五个路由值之一                                                         | 未定义独立approval token/主体             |
| Bible §6.6，P0160–0163；§8，P0189；附录B，P0377 | verify/deep/human进入compile/validate；Valid后commit；伪代码没有human等待分支 | 不能据此宣称完整人类审批已存在            |
| operators.py:199–204                            | 返回human并用requires human gate作为理由                                      | 这段理由比参考管线更强                    |
| kernel.py:66–103 / store.py:105                 | Valid写active；检查validator/evidence，未检查本次独立批准                     | 不证明现实工具越权                        |
| test_kernel_cases.py / test_operators.py        | 覆盖veto/缺证据/普通路径，未锁定human未批准的kernel语义                       | 测试通过不能替Owner选合同                 |

建议优先考虑 **ADVISORY_ROUTE（待Owner选择）**，它更接近Bible现有参考管线；同时明确禁止把该route当审批门禁。若Owner要 **MANDATORY_GATE**，这是需记录的合同强化：Valid仍不等于批准，未批只pending。

[R02条件性提案](evidence/R02_TFRK_MANDATORY_PROPOSAL.diff)仅供选择MANDATORY_GATE后考虑；当前CONTRACT_AMBIGUITY，故未应用/未测试。拟保留human待批、普通deep可commit、veto仍rejected、缺证据pending，并查真实合成store状态；不新增批准身份、不提供自动同意，也未交付恢复审批入口。两方案互斥，本周未代签任何一种。

## WP-3 · MAINTENANCE_STATUS

| 版本                              | assets/src/index.ts 内容SHA-256                                  | 当前可说                        |
| --------------------------------- | ---------------------------------------------------------------- | ------------------------------- |
| public main64137d3 / fault21851ce | 1585623063dd1930ef2bad665749738f1b95ff596819f1ca769deba41c47529c | PUBLIC_UNFIXED                  |
| local fix6523390 / HEADd58c941    | 9303c63d6d2e17f7c1734e8ca7660f05abb5de3c2da5035fcf2dc346710e6101 | LOCAL_FIXED；独立性仍是结构计数 |

公开main到本地差异10文件（536增/17删），核心修复四文件，其余为Field Probe协议/记录。C1红绿为10-30的Node24.15/TS5.9.3/Zod4.1.5 domain预检：fault 5 failed/4 passed，fixed 9 passed；本周未重跑，不是P1主体结果。

默认Node24.15、另一已知Node24.22.1；未取得现成Node22.13/pnpm11.19匹配执行组合。完整pnpm verify=NOT_RUN / CANONICAL_OPEN。不安装工具链、不放宽pins，不用旧公开CI关闭本地新修复门禁。未来维护发布需匹配环境verify、必要安全/隐私审查、精确版本/变更说明及单独Owner发布许可。

## 研究冻结与最小退出

P1/P1-Lite/G0-B环境修理/P2真实记忆试验均NOT_RUN。Memory选中、送达、实际采用、影响是不同命题；用普通Git/Issue/笔记即可提出一行DESIGN_ONLY引用，不建Schema/引擎。普通工具足够则NO_ADDITION/ABSTAIN。

本周实测人工工时、Token/费用和真实任务净收益UNKNOWN；一轮后验审查只支持有限修订，不能关闭P0或无限滚动下周施工。最终Owner建议及原始Reviewer意见见[Week Closure](WEEK_CLOSURE_DECISION.md)。

## Owner批准后的限定续作 · 2026-11-04

负责人已批准按计划继续；上文WP表与未执行状态为预审历史，本节为最新增量。授权用于元数据级核查、R01合成副本验证及既定研究工件同步，不自动扩大为真实宿主停用、核心合入或发布。

- Habitat元数据：已知两个Skill根和插件cache顶层的名称检查未见同名安装；公共installer自身并不证明宿主注册。未打开真实Habit目录/配置/日志，未禁用任何对象；FENCE_HOST仍UNKNOWN，不能以未找到当已停用。
- R01：仅在新建合成HOME应用既有wx单行候选。[新收据](evidence/R01_APPROVED_RECEIPT.json)显示同批控制通过、碰撞不覆盖且buffer保留，但第二次flush失败；索引写失败后出现未入索引文件，一次普通重试仍失败。结论ABORT_PATCH / INCOMPLETE_RECOVERY；停止该候选，不继续补平台或合入。
- TFRK：沿已建议ADVISORY方向形成最小文档候选：将human解释为验证/审查优先级标签，明确它不提供等待批准保证；requires human gate文案若要保留为强制承诺，须另批MANDATORY合同。此为文档候选，正式T仓未改；未把笼统续作批准冒充互斥合同已经签选。
- canonical：已知5个bundled Node均24.19或24.22.1，默认24.15；未取得22.13现成组合，不安装/升级。pnpm verify仍NOT_RUN。

总状态仍HOLD_FOR_P0。当前可行退出为保留旧写入口FENCE，并由负责人明确宿主核查/停用范围；若需要恢复写入，不能把本次wx候选作为完整修复使用。
