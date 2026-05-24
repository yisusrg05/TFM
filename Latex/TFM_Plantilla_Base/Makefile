PROJECT=A0.MiTFG
TEX=pdflatex
BIBTEX=bibtex
BUILDTEX=$(TEX) $(PROJECT).tex

all:
	$(BUILDTEX)
	$(BIBTEX) $(PROJECT)
	$(BUILDTEX)
	$(BUILDTEX)
clean-all:
	rm -f *.log *.bak *.aux *.bbl *.blg *.idx *.toc *.out *.mtc* *.maf *.lot *.lof *.fdb_* *.fls *.ilg *.ind *.synctex.gz *.dvi *~ *.pdf *.dvi

clean:
	rm -f *.log *.bak *.aux *.bbl *.blg *.idx *.toc *.out *.mtc* *.maf *.lot *.lof *.fdb_* *.fls *.ilg *.ind *.synctex.gz *.dvi *~
