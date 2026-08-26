import asyncio
import json

import api_utils
import streamlit as st
from loguru import logger
from state_management import new_chat, update_document_list, update_thread, update_user_threads


# ---------------------------------------------------------------------------
# 聊天消息操作辅助：中止 / 编辑 / 补充 / 重发
# ---------------------------------------------------------------------------


def _last_human_content() -> str:
    """返回最近一条 human 消息的内容（没有则返回空串）。"""
    for message in reversed(st.session_state["thread"].messages):
        if message.get("role") == "human":
            return message.get("content", "")
    return ""


def _remove_last_ai_message() -> None:
    """移除最近一条 ai 消息，用于重发时替换旧回答。"""
    messages = st.session_state["thread"].messages
    for i in range(len(messages) - 1, -1, -1):
        if messages[i].get("role") == "ai":
            del messages[i]
            break


def _start_edit() -> None:
    st.session_state["action"] = "edit"
    st.session_state["action_text"] = _last_human_content()


def _start_supplement() -> None:
    st.session_state["action"] = "supplement"
    st.session_state["action_text"] = ""


def _start_resend() -> None:
    """原样重发最近一条问题。"""
    content = _last_human_content()
    if not content:
        return
    _remove_last_ai_message()
    st.session_state["action"] = None
    st.session_state["resend_prompt"] = content
    st.rerun()


def _commit_action(text: str) -> None:
    """提交编辑/补充内容：改写消息列表并触发重发。"""
    text = text.strip()
    if not text:
        st.error("内容不能为空")
        return

    messages = st.session_state["thread"].messages
    action = st.session_state.get("action")

    if action == "edit":
        # 编辑：替换最近一条 human 消息
        for i in range(len(messages) - 1, -1, -1):
            if messages[i].get("role") == "human":
                messages[i]["content"] = text
                break
        else:
            messages.append({"role": "human", "content": text})
    else:
        # 补充：追加一条新的 human 消息，保留原问题
        messages.append({"role": "human", "content": f"补充说明：{text}"})

    _remove_last_ai_message()
    st.session_state["action"] = None
    st.session_state["resend_prompt"] = text
    st.rerun()


def _render_message_actions() -> None:
    """在最近一条 AI 回答下方渲染：编辑后重发 / 补充后重发 / 重发。"""
    messages = st.session_state["thread"].messages
    if not messages or messages[-1].get("role") != "ai":
        return

    col1, col2, col3 = st.columns(3)
    if col1.button("✏️ 编辑后重发", key="action_edit", use_container_width=True):
        _start_edit()
    if col2.button("➕ 补充后重发", key="action_supplement", use_container_width=True):
        _start_supplement()
    if col3.button("🔁 重发", key="action_resend", use_container_width=True):
        _start_resend()


def _render_edit_supplement_ui() -> None:
    """编辑/补充输入框 + 重发/取消按钮。"""
    action = st.session_state.get("action")
    if action not in ("edit", "supplement"):
        return

    with st.container(border=True):
        if action == "edit":
            st.caption("✏️ 编辑问题后重发：")
            new_text = st.text_area(
                "问题内容",
                value=st.session_state.get("action_text", ""),
                key="action_text_area",
                height=100,
            )
        else:
            st.caption("➕ 在上一问基础上补充说明：")
            new_text = st.text_area("补充内容", value="", key="action_text_area", height=80)

        col1, col2 = st.columns(2)
        if col1.button("🚀 重发", key="action_commit", use_container_width=True):
            _commit_action(new_text)
        if col2.button("取消", key="action_cancel", use_container_width=True):
            st.session_state["action"] = None
            st.rerun()


def _stream_agent_reply(
    prompt: str,
    thread_id,
    show_human: bool,
    agent_mode: bool,
    is_first_message: bool = False,
) -> None:
    """
    流式生成回答并存入 thread.messages。

    - agent_mode=True：走带工具/记忆的 /chat/{thread_id}（解析 tool_call/tool_result）
    - agent_mode=False：走无工具的 /chat/ 简单流
    - 支持「中止生成」：点击按钮中断当前运行，已生成的内容会保留
    """
    if show_human:
        st.session_state["thread"].messages.append({"role": "human", "content": prompt})
        with st.chat_message("human"):
            st.markdown(prompt)

    st.session_state["stop_generation"] = False
    st.session_state["gen_counter"] = st.session_state.get("gen_counter", 0) + 1

    with st.chat_message("ai"):
        steps_container = st.container()
        answer_placeholder = st.empty()
        full_response = ""

        def request_stop() -> None:
            st.session_state["stop_generation"] = True

        stop_placeholder = st.empty()
        with stop_placeholder:
            st.button(
                "⏹ 中止生成",
                key=f"stop_gen_{st.session_state['gen_counter']}",
                on_click=request_stop,
            )

        async def fetch_stream():
            nonlocal full_response
            aborted = False
            try:
                chat_data = {"prompt": prompt, "model_name": st.session_state["model_name"]}
                if agent_mode:
                    stream = api_utils.chat_stream(chat_data, thread_id)
                else:
                    stream = api_utils.simple_chat_stream(chat_data)

                async for line in stream:
                    if st.session_state.get("stop_generation", False):
                        logger.info("用户请求中止，停止接收流")
                        break

                    try:
                        event = json.loads(line)
                    except (json.JSONDecodeError, KeyError) as e:
                        logger.warning(f"Could not parse stream event: {line} - Error: {e}")
                        continue

                    event_type = event.get("type")
                    if agent_mode:
                        if event_type == "tool_call":
                            with steps_container:
                                st.markdown(
                                    f"**工具调用：** 执行 `{event['name']}`，参数：`{event['args']}`"
                                )
                        elif event_type == "tool_result":
                            with steps_container:
                                with st.expander(f"**工具结果：** `{event['name']}`", expanded=False):
                                    st.code(event["content"], language="json")
                        elif event_type == "llm_chunk":
                            full_response += event.get("content", "")
                            answer_placeholder.markdown(full_response + "▌")
                        else:
                            logger.warning(f"Unknown event type: {event_type}")
                            st.warning(event)
                    else:
                        if event_type == "llm_chunk":
                            full_response += event.get("content", "")
                            answer_placeholder.markdown(full_response + "▌")

                answer_placeholder.markdown(full_response)

            except Exception as e:
                st.error("处理请求时出错。")
                logger.error(f"Error in fetch_stream: {e}")
                aborted = True
                if is_first_message and thread_id is not None:
                    try:
                        api_utils.delete_thread(thread_id)
                        logger.info(f"Thread {thread_id} deleted")
                    except Exception as delete_error:
                        logger.error(f"Failed to delete thread {thread_id}: {delete_error}")
                    new_chat()
            finally:
                try:
                    stop_placeholder.empty()
                except Exception:
                    pass
                if full_response and not aborted:
                    st.session_state["thread"].messages.append({"role": "ai", "content": full_response})

        with st.spinner("正在生成回答..."):
            asyncio.run(fetch_stream())


def authenticated_user_chat_interface_component():
    for message in st.session_state["thread"].messages:
        with st.chat_message(message["role"]):
            st.markdown(message["content"])

    _render_message_actions()
    _render_edit_supplement_ui()

    if prompt := st.chat_input(
        "输入问题...", accept_file="multiple", key="prompt", file_type=["pdf", "docx", "txt"]
    ):
        is_first_message = False
        if st.session_state["thread"].id is None:
            is_first_message = True
            thread_id = api_utils.create_new_thread().get("id")
            if thread_id is None:
                raise ValueError("Something happened")
            st.session_state["thread"].id = thread_id

        text = prompt.text or ""
        files = prompt.files or []
        if text:
            st.session_state["thread"].messages.append({"role": "human", "content": text})

        if is_first_message:
            update_thread(st.session_state["thread"].id, f"{text[:30]}")
            update_user_threads()

        with st.chat_message("human"):
            st.markdown(text or "*[文件上传]*")
            for up in files:
                st.write(f"📂 {up.name}")

        for file in files:
            with st.spinner(f"正在上传 {file.name}…"):
                resp = api_utils.upload_document(st.session_state["thread"].id, file)
                if resp:
                    st.success(f"上传成功 {file.name} ➝ ID {resp['document_id']}")
                else:
                    st.error(f"上传失败 {file.name}")

        if files:
            update_document_list(st.session_state["thread"].id)

        _stream_agent_reply(
            prompt=text,
            thread_id=st.session_state["thread"].id,
            show_human=False,          # 人类消息已在上方渲染
            agent_mode=True,
            is_first_message=is_first_message,
        )

    if st.session_state.get("resend_prompt"):
        prompt_text = st.session_state.pop("resend_prompt")
        _stream_agent_reply(
            prompt=prompt_text,
            thread_id=st.session_state["thread"].id,
            show_human=False,          # 编辑/补充后，消息列表已在顶部渲染
            agent_mode=True,
        )


def unauthenticated_user_chat_interface_component():
    for message in st.session_state["thread"].messages:
        with st.chat_message(message["role"]):
            st.markdown(message["content"])

    _render_message_actions()
    _render_edit_supplement_ui()

    if prompt := st.chat_input("输入问题...", key="prompt"):
        st.session_state["thread"].messages.append({"role": "human", "content": prompt})

        with st.chat_message("human"):
            st.markdown(prompt)

        _stream_agent_reply(
            prompt=prompt,
            thread_id=None,
            show_human=False,          # 人类消息已在上方渲染
            agent_mode=False,
        )

    if st.session_state.get("resend_prompt"):
        prompt_text = st.session_state.pop("resend_prompt")
        _stream_agent_reply(
            prompt=prompt_text,
            thread_id=None,
            show_human=False,
            agent_mode=False,
        )