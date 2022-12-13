from setuptools import find_packages, setup

with open("requirements.txt") as f:
	install_requires = f.read().strip().split("\n")

# get version from __version__ variable in wiki/__init__.py
from wiki import __version__ as version

setup(
	name="wiki",
	version=version,
	description="Simple Wiki App",
	author="Frappe",
	author_email="developers@frappe.io",
	packages=find_packages(),
	zip_safe=False,
	include_package_data=True,
	install_requires=install_requires,
)
