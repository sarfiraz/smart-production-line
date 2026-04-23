import logging
import threading

from app.services.ml_service import main as ml_main
from app.services.chatgpt_service import main as chatgpt_main

logger = logging.getLogger(__name__)


def start_ml_service():
    thread = threading.Thread(
        target=_run_ml,
        daemon=True,
        name="ml-service"
    )
    thread.start()
    logger.info("ML service started in background thread")


def start_chatgpt_service():
    thread = threading.Thread(
        target=_run_chatgpt,
        daemon=True,
        name="chatgpt-service"
    )
    thread.start()
    logger.info("ChatGPT service started in background thread")


def _run_ml():
    try:
        ml_main()
    except Exception as e:
        logger.error(f"ML service crashed: {e}", exc_info=True)


def _run_chatgpt():
    try:
        chatgpt_main()
    except Exception as e:
        logger.error(f"ChatGPT service crashed: {e}", exc_info=True)
