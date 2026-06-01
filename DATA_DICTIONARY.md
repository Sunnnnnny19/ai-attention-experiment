# Data Dictionary

## participants.jsonl
- participant_id: 匿名被试ID
- login_code: 实验邀请码
- group_condition: 随机实验组
- client_meta: 屏幕、浏览器、时区等客户端信息

## sessions.jsonl
- session_id: 实验会话ID
- participant_id: 匿名被试ID
- start_time / end_time
- completion_status
- total_duration_ms

## events.jsonl
事件流数据。
- event_type: screen_view, click, scroll_depth, aoi_enter, aoi_leave, hover_enter, hover_leave, prompt_submit, choice_select, tab_blur, tab_focus 等
- event_target: 事件对象，如 performance, price_value, chat
- payload: 事件细节
- timestamp_client / server_time

## chats.jsonl
AI交互日志。
- user_prompt
- model_response
- latency_ms
- usage
- model_name

## surveys.jsonl
前测、认知题、量表题。
- survey_name: pretest / cognitive / post_scales
- answers: 题项答案

## reviews.jsonl
任务后开放评论 / 类UGC文本。
- review_text
- word_count
- char_count
