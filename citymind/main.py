from __future__ import annotations

import tkinter as tk

from ui import CityMindApp


def main() -> None:
    root = tk.Tk()
    CityMindApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
