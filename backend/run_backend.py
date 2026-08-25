import asyncio,selectors
import uvicorn
asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
if __name__ == '__main__':
    uvicorn.run('app.main:app', host='0.0.0.0', port=8000)
