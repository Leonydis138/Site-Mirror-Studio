            <iframe
              title={`Preview of ${job.url ?? 'mirrored site'}`}
              src={previewUrl}
              sandbox="allow-scripts allow-same-origin allow-downloads allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-pointer-lock allow-presentation"
              allow="fullscreen; autoplay; clipboard-write; encrypted-media; gamepad; microphone; camera; display-capture"
              className="h-[min(72dvh,780px)] w-full rounded-xl border border-[hsl(var(--border))] bg-white"
            />
