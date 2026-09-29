#!/usr/bin/env python3
# 本地测试脚本：用火山方舟 Python SDK 验证「豆包润色」链路是否通。
# 仅用于你本机验 key + 接入点，不参与小程序（小程序云函数 ai_gen 是 Node，用原生 https）。
#
# 用法：
#   cd comic_miniapp
#   python -m venv .venv && .venv\Scripts\activate      # Windows
#   pip install --upgrade "volcengine-python-sdk[ark]"
#   set ARK_API_KEY=你的key
#   set ARK_EP=ep-xxxxxxxx                              # 你的接入点 ID
#   python test_ark_polish.py
#
# 注意：key 只走环境变量，绝不写进此文件 / 不贴到聊天里。
# 本脚本与 ai_gen/index.js 主路径一致：Responses API + 显式前缀缓存(caching.prefix)。
import os
from volcenginesdkarkruntime import Ark

API_KEY = os.getenv("ARK_API_KEY")
EP = os.getenv("ARK_EP")
BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"

# 与 ai_gen/index.js 的两套系统提示词保持一致（均 ≥256 token 以跨过缓存门槛）
SYSTEM_PROMPT_COMIC = (
    "你是一个专业的画面感内容脚本润色助手。用户的输入可能是一段故事、一个想法、一段生活记录或一段草稿，你需要把它改写成「可直接交给画师逐格绘制」的画面感内容叙事脚本（请注意：这是叙事脚本，不是分镜表，不要写镜头距离、构图、景别等技术指令）。\n"
    "请严格按以下要求处理：\n"
    "① 按叙事顺序把内容整理成 4–8 个「格」（段落），开头要有能抓住注意力的钩子，结尾留有余味或一个小转折。\n"
    "② 每一格用一两句具体、可落笔的话写出「这一格里发生了什么、画面里能看到什么」：明确的人物动作、神态、场景细节、物件；少用抽象形容词，多用看得见、画得出的具体描写。\n"
    "③ 每一格配一句「台词或旁白」：台词要口语化、带角色性格；旁白要短，只补画面之外、读者需要知道的信息。\n"
    "④ 保持原作者原本的情绪、基调和真实感，不擅自改写结局，不添加原文没有的人物和人物关系。\n"
    "⑤ 只输出润色后的脚本正文，用「第N格」分段；不要解释、不要加引号、不要写前缀或总结语。"
)

SYSTEM_PROMPT_MOMENTS = (
    "你是一个擅长写朋友圈文案的高手，尤其精通「防折叠」技巧——即把一段普通文字改写成发到朋友圈不容易被折叠、容易被朋友读完并点赞的文案。用户的输入是一段他想分享的内容（故事、感悟、产品、活动皆可）。\n"
    "请严格按以下要求处理：\n"
    "① 一次性产出 3 条风格不同的朋友圈文案，分别用【1】【2】【3】开头，每条之间用【1】【2】【3】清晰分隔，不要混在一起。\n"
    "② 每条文案都做「防折叠」处理：前 6–15 个字就要出现最抓人的信息或情绪点（朋友圈默认只展开前一两行，黄金位置必须留住人）；多用短句、换行，emoji 适度点缀，但不要用烂大街的营销套话。\n"
    "③ 三条风格要有区分：一条偏「故事感/叙事」（让人想读完），一条偏「金句/观点」（易被转发收藏），一条偏「轻松/口语」（像随手发的真实分享）。\n"
    "④ 保留用户原本想表达的核心信息和真实情绪，不夸大、不制造恐慌、不硬凹人设；产品/活动类要自然带出，不显得像广告。\n"
    "⑤ 只输出 3 条文案正文，用【1】【2】【3】分隔；不要解释、不要额外加总结。"
)

# 默认测 comic；set TEST_MODE=moments 可测朋友圈文案分支
MODE = os.getenv("TEST_MODE", "comic")
SYSTEM_PROMPT = SYSTEM_PROMPT_MOMENTS if MODE == "moments" else SYSTEM_PROMPT_COMIC
print(f"🧪 当前测试模式：{MODE}（与 ai_gen mode='{MODE}' 一致）")

if not API_KEY:
    raise SystemExit("❌ 请先设置环境变量 ARK_API_KEY")
if not EP:
    raise SystemExit("❌ 请先设置环境变量 ARK_EP（你的接入点 ID，形如 ep-xxxxxxxx）")

client = Ark(base_url=BASE_URL, api_key=API_KEY)

test_input = "我小时候在河边遇见一只白鹭，它飞起来的样子很好看。"

# 与 ai_gen/index.js 主路径一致：Responses API + 显式前缀缓存
try:
    resp = client.responses.create(
        model=EP,
        input=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": test_input},
        ],
        caching={"type": "enabled", "prefix": True},
        temperature=0.8,
        max_output_tokens=1500,
    )
    # 兼容两种输出结构
    out = None
    if getattr(resp, "output_text", None):
        out = resp.output_text
    elif resp.output and resp.output[0].content and resp.output[0].content[0].text:
        out = resp.output[0].content[0].text

    if not out:
        raise RuntimeError("模型返回为空（output_text / output[0].content[0].text 均取不到）")

    print("✅ 调用成功（Responses + 前缀缓存），润色结果：\n")
    print(out)
    if getattr(resp, "usage", None):
        print("\n📊 usage:", resp.usage)
        cached = getattr(resp.usage, "prompt_tokens_details", None)
        if cached and getattr(cached, "cached_tokens", 0):
            print("🎯 命中缓存 token 数：", cached.cached_tokens, "（>0 即前缀缓存已生效）")
except Exception as e:
    print("❌ Responses 路径失败：", e)
    print("（云函数会自动回退 chat/completions；本地可改用 curl /chat/completions 验证 key 本身是否通）")
