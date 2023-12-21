OPTIMISING PERFORMANCE

The main reasons for the drop in performance are the numerous blend mode switches that are the result of the transparent and opaque textures. Possible solution directions include:
1. Keep track of the active 16/256 clut's.  
When a clut only contains transparent values or only opaque colours it will eliminate the need for either a transparent or opaque rendering of a transparent textured primitives. 
The downside is that it does not work for 16-bit textures but these are less common. Another downside is that the clut-cache could be difficult or a lot of work to get right.
2. Draw all opaque textures first.  
This should eliminate the blend mode switches when drawing transparent textured primitives but does not solve the many blend mode switches. 
A notible added benifit is that the opaque primitives can be drawn in reverse order with a depth buffer enabling the GPU to render less pixels.
3. Group transparent primitives of the same blend mode.  
To reduce the switches between blend modes one can group transparent primitives of different blendmodes as long as primitives of different blend modes do not overlap. This is however a theoretical imrpovement and should only be implemented after investigating it effectiveness.