import api_utils
import streamlit as st
from chat_components import authenticated_user_chat_interface_component, unauthenticated_user_chat_interface_component
from state_management import Page, authenticate_user


def home_page():
    st.title("💬 AI 智能问答助手")
    if not st.session_state["user"].is_authenticated:
        st.markdown(
            """
            欢迎使用！本智能助手基于检索增强生成（RAG）技术，帮你从文档中快速找到答案。

            ### ✨ 登录后可用功能：
            - 提问并获得智能、贴合上下文的回答。
            - 上传自己的文档，获得针对性解答。
            - 使用联网搜索回答通用知识问题。
            - 支持**对话记忆**，可回顾历史对话。
            """
        )
        st.subheader("💡 你想问什么？", divider="rainbow")
        unauthenticated_user_chat_interface_component()
    else:
        st.subheader("💡 你想问什么？", divider="rainbow")
        authenticated_user_chat_interface_component()


def login_page():
    st.subheader("🔐 登录", divider="rainbow")
    with st.form("login_form"):
        email = st.text_input("邮箱 *")
        password = st.text_input("密码 *", type="password")
        submitted = st.form_submit_button("登录")

    back_to_home_component()

    if submitted:
        with st.spinner("正在登录..."):
            login_response = api_utils.login_user(email, password)
            if message := login_response.get("message"):
                st.success(message)
                st.session_state["page"] = Page.HOME
                authenticate_user(login_response)
                st.rerun()
            else:
                st.error(login_response.get("detail", "登录失败，请重试。"))


def register_page():
    st.subheader("✍ 注册", divider="rainbow")
    with st.form("register_form"):
        col1, col2 = st.columns(2)
        email = col1.text_input("Email *")
        username = col1.text_input("用户名 *", max_chars=16)
        password = col1.text_input("Password *", type="password", max_chars=32)
        first_name = col2.text_input("名字", max_chars=50)
        last_name = col2.text_input("姓氏", max_chars=50)

        submitted = st.form_submit_button("注册")

    back_to_home_component()

    if submitted:
        register_data = {
            "email": email,
            "username": username,
            "password": password,
            "first_name": first_name,
            "last_name": last_name,
        }
        with st.spinner("正在注册..."):
            register_response = api_utils.register_user(register_data)
            if message := register_response.get("message"):
                st.success(message)
                st.session_state["page"] = Page.LOGIN
                st.rerun()
            else:
                st.error(register_response.get("detail", "注册失败，请重试。"))


def back_to_home_component():
    if st.button("⬅️ 返回首页", type="tertiary"):
        st.session_state["page"] = Page.HOME
        st.rerun()
