import asyncio, sys; async def main(): p = await asyncio.create_subprocess_exec(sys.executable, "--version"); await p.wait(); print(p.returncode); asyncio.run(main())
