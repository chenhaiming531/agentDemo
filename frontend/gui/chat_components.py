import asyncio
import json

import api_utils
import streamlit as st
from loguru import logger
from state_management import new_chat, update_document_list, update_thread, update_user_threads


def authenticated_user_chat_interface_component():
    is_first_message = False
    for message in st.session_state["thread"].messages:
        with st.chat_message(message["role"]):
            st.markdown(message["content"])

    if prompt := st.chat_input(
        "输入问题...", accept_file="multiple", key="prompt", file_type=["pdf", "docx", "txt"]
    ):
        if st.session_state["thread"].id is None:
            is_first_message = True
            thread_id = api_utils.create_new_thread().get("id")
            if thread_id is None:
                raise ValueError("Something happend")
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

        with st.chat_message("ai"):
            steps_container = st.container()
            answer_placeholder = st.empty()
            full_response = ""

            async def fetch_stream():
                nonlocal full_response
                try:
                    chat_data = {"prompt": text, "model_name": st.session_state["model_name"]}
                    async for line in api_utils.chat_stream(chat_data, st.session_state["thread"].id):
                        try:
                            event: dict = json.loads(line)
                            event_type = event.get("type")

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

                        except (json.JSONDecodeError, KeyError) as e:
                            logger.warning(f"Could not parse stream event: {line} - Error: {e}")

                    answer_placeholder.markdown(full_response)
                    if full_response:
                        st.session_state["thread"].messages.append({"role": "ai", "content": full_response})

                except Exception as e:
                    st.error("处理请求时出错。")
                    logger.error(f"Error in fetch_stream: {e}")
                    if is_first_message:
                        api_utils.delete_thread(st.session_state["thread"].id)
                        logger.info(f"Thread {st.session_state['thread'].id} deleted")
                        new_chat()

            with st.spinner("正在生成回答..."):
                asyncio.run(fetch_stream())


def unauthenticated_user_chat_interface_component():
    for message in st.session_state["thread"].messages:
        with st.chat_message(message["role"]):
            st.markdown(message["content"])

    if prompt := st.chat_input("输入问题...", key="prompt"):
        st.session_state["thread"].messages.append({"role": "human", "content": prompt})

        with st.chat_message("human"):
            st.markdown(prompt)

        with st.chat_message("ai"):
            placeholder = st.empty()
            full_response = ""

            async def fetch_stream():
                nonlocal full_response
                try:
                    chat_data = {"prompt": prompt, "model_name": st.session_state["model_name"]}
                    async for line in api_utils.simple_chat_stream(chat_data):
                        try:
                            chunk = json.loads(line).get("content")
                            full_response += chunk
                            placeholder.markdown(full_response + "▌")
                        except (json.JSONDecodeError, KeyError) as e:
                            logger.warning(f"Could not parse stream event: {line} - Error: {e}")

                    placeholder.markdown(full_response)
                    st.session_state["thread"].messages.append({"role": "ai", "content": full_response})
                except Exception:
                    st.error("处理请求时出错，请重试。")

            with st.spinner("正在生成回答..."):
                asyncio.run(fetch_stream())
