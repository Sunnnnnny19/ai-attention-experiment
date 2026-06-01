# AI Attention Experiment MVP

一个可直接运行的网页在线实验系统，用于“AI产品用户注意力测量”研究。它包含：

- 匿名登录 / session 管理
- 知情同意与前测
- 标准化实验任务页面
- 嵌入式 ChatGPT 式对话窗口（后端调用 OpenAI API）
- 行为日志：点击、滚动、悬停、AOI进入/离开、复制、焦点切换
- AI交互日志：prompt、模型回复、延迟、token usage
- 认知题：自由回忆、识别题、重要性排序
- 量表题：认知负荷、感知有用性、满意度、继续使用等
- 任务后开放评论：模拟 UGC
- JSONL 数据存储与 CSV/JSONL 导出

## 1. 安装

```bash
npm install
cp .env.example .env
```

打开 `.env`，填入 `OPENAI_API_KEY`。本地测试可保持：

```bash
ALLOW_MOCK_AI=true
```

这时不会真的调用 OpenAI API，会返回模拟AI回复。

## 2. 启动

```bash
npm run dev
```

浏览器打开：

```text
http://localhost:3000
```

## 3. 数据文件

运行后数据保存在：

```text
data/participants.jsonl
data/sessions.jsonl
data/events.jsonl
data/chats.jsonl
data/surveys.jsonl
data/reviews.jsonl
```

每一行是一条 JSON 记录，便于后续用 Python/R 导入分析。

## 4. 数据导出

设置 `.env`：

```bash
ADMIN_EXPORT_KEY=your-secret-key
```

访问：

```text
http://localhost:3000/api/export/events?format=csv&key=your-secret-key
http://localhost:3000/api/export/chats?format=jsonl&key=your-secret-key
```

可导出的 table：

```text
participants, sessions, events, chats, surveys, reviews
```

## 5. 重要安全说明

- OpenAI API Key 只保存在服务端 `.env`，不要写进前端。
- 默认使用匿名 participant_id；不要收集姓名、手机号、身份证等敏感信息。
- 正式实验前，请根据学校伦理审查要求修改知情同意书。
- 该 MVP 使用 JSONL 文件存储，适合原型和中小样本；正式部署建议改为 PostgreSQL/Supabase/MySQL。

## 6. 建议研究流程

1. 登录 / 匿名ID
2. 知情同意
3. 前测
4. 标准化AI产品体验任务
5. 与AI助手交互
6. 认知回忆/识别
7. 量表
8. 开放评论
9. 完成页

## 7. 后续可扩展

- 接入眼动/生理设备：通过事件 marker 或外部同步接口写入 events
- 加随机实验组：在 `/api/login` 中扩展 group_condition
- 加数据库：将 `appendJsonl()` 替换为数据库 insert
- 加被试质量控制：最短作答时间、注意力检测题、重复IP限制
