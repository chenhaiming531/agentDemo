import api_utils
import streamlit as st
from config import settings
from state_management import Page, change_thread, logout_user, new_chat, update_document_list, update_user_threads


def display_sidebar():
    st.sidebar.title("🔗 LangGraph RAG 智能助手")
    if st.session_state["user"].is_authenticated:
        greeting_component()
        model_selection_component()
        chat_history_component()
        document_list_component()
        logout_component()
    else:
        authentication_component()


def authentication_component():
    st.sidebar.subheader("🔒 登录/注册", divider="rainbow")
    col1, col2 = st.sidebar.columns(2)
    if col1.button("登录"):
        st.session_state["page"] = Page.LOGIN
    if col2.button("注册"):
        st.session_state["page"] = Page.REGISTER
    st.sidebar.markdown("**请登录或注册以使用全部功能。**")


def greeting_component():
    st.sidebar.subheader(f"👋 欢迎，{st.session_state['user'].username}", divider="rainbow")
    if st.sidebar.button("新建会话"):
        new_chat()


def model_selection_component():
    st.sidebar.subheader("🤖 选择模型", divider="rainbow")
    st.session_state["model_name"] = st.sidebar.selectbox(
        "Select Model",
        options=settings.model_names,
        key="model",
        label_visibility="collapsed",
    )


def chat_history_component():
    st.sidebar.subheader("🗨️ 历史会话", divider="rainbow")
    threads = st.session_state["user"].threads

    if threads:
        for thread in threads:
            col1, col2, col3 = st.sidebar.columns([0.15, 0.70, 0.15])
            with col1:
                if st.button("✅", key=f"select_{thread['id']}"):
                    change_thread(thread["id"])
            with col2:
                st.markdown(f"{thread['title']}")
            with col3:
                if st.button("❌", key=f"delete_{thread['id']}"):
                    with st.spinner(""):
                        delete_response = api_utils.delete_thread(thread["id"])
                        if delete_response.get("status") == "ok":
                            success_message = f"会话 {thread['title']} 删除成功。"
                            st.sidebar.success(success_message)
                            update_user_threads()
                            new_chat()
                            st.rerun()
                        else:
                            st.sidebar.error("删除会话失败")


def document_list_component():
    st.sidebar.subheader("📂 文档列表", divider="rainbow")
    documents = st.session_state["thread"].documents
    if documents:
        for number, doc in enumerate(documents, start=1):
            col1, col2 = st.sidebar.columns([0.85, 0.15])
            with col1:
                st.markdown(f"{number}. {doc['file_name']}")
            with col2:
                if st.button("❌", key=f"delete_{doc['id']}"):
                    with st.spinner(""):
                        delete_response = api_utils.delete_document(doc["id"])
                        if delete_response:
                            success_message = f"文档 {doc['id']} 删除成功。"
                            st.sidebar.success(success_message)
                            update_document_list(st.session_state["thread"].id)
                            st.rerun()
                        else:
                            st.sidebar.error("删除文档失败")
    else:
        st.sidebar.write("尚未上传文档。")


def logout_component():
    st.sidebar.subheader("❌ 退出登录", divider="rainbow")
    if st.sidebar.button("退出"):
        logout_user()
        st.rerun()
